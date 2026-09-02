#!/usr/bin/env bash
# ============================================================
# Tyre Flow 服务器端部署脚本（在服务器上以 root 执行）
#
# GitHub Actions 通过 ssh 调用:
#   ssh root@HOST 'bash -s -- deploy <git-sha> <artifact-sha256>' < scripts/server/deploy.sh
# 手动:
#   deploy.sh deploy <git-sha> [artifact-sha256]   部署某次构建（产物由 CI 上传到 GitHub Release）
#   deploy.sh rollback                              回滚到上一个 release
#   deploy.sh status                                查看当前状态
#
# 流程: 同步仓库 -> 下载并校验产物 -> 解压到 releases/<时间>-<sha> -> 安装 prisma CLI（版本变化时）
#      -> db push + seed -> 更新签名服务 -> 切换 current -> 重启 -> 健康检查（失败自动回滚）-> 清理
#
# 目录布局（由 provision.sh 创建）:
#   /opt/tyre-flow/repo        git checkout（签名服务源码 + 字体）
#   /opt/tyre-flow/releases/*  每次部署一个目录（Next standalone 产物）
#   /opt/tyre-flow/current     指向当前 release 的软链
#   /opt/tyre-flow/previous    指向上一个 release 的软链（回滚用）
#   /opt/tyre-flow/shared      .env 与持久化数据（data/iscc-exports）
#   /opt/tyre-flow/tools       prisma CLI
#   /opt/tyre-flow/signature   签名服务 venv
# ============================================================
set -euo pipefail

APP_USER="tyreflow"
APP_ROOT="/opt/tyre-flow"
APP_HOME="${APP_ROOT}/home"
REPO_DIR="${APP_ROOT}/repo"
RELEASES_DIR="${APP_ROOT}/releases"
SHARED_DIR="${APP_ROOT}/shared"
TOOLS_DIR="${APP_ROOT}/tools"
TMP_DIR="${APP_ROOT}/tmp"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

REPO_URL="${DEPLOY_REPO_URL:-https://github.com/eyyoung/tyre-flow.git}"
RELEASE_TAG="${DEPLOY_RELEASE_TAG:-deploy-artifacts}"
ARTIFACT_BASE_URL="${DEPLOY_ARTIFACT_BASE_URL:-https://github.com/eyyoung/tyre-flow/releases/download/${RELEASE_TAG}}"

NPM_REGISTRY="https://registry.npmmirror.com"
PRISMA_ENGINES_MIRROR="https://registry.npmmirror.com/-/binary/prisma"
PIP_INDEX_URL="https://mirrors.aliyun.com/pypi/simple/"

WEB_HEALTH_URL="http://127.0.0.1:3000/api/health"
WORKER_HEALTH_URL="http://127.0.0.1:3001/api/health"
SIGNATURE_HEALTH_URL="http://127.0.0.1:3333/"

log()  { printf '\033[0;34m[deploy]\033[0m %s\n' "$*"; }
ok()   { printf '\033[0;32m[deploy] ✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[deploy] ⚠ %s\033[0m\n' "$*"; }
die()  { printf '\033[0;31m[deploy] ✘ %s\033[0m\n' "$*" >&2; exit 1; }

# 以应用用户执行（文件归属统一为 tyreflow，服务也以该用户运行）
as_app() {
  runuser -u "$APP_USER" -- env HOME="$APP_HOME" PATH="/usr/local/bin:/usr/bin:/bin" "$@"
}

# 从 shared/.env 读取某个变量（用 shell 解析，兼容 KEY='value' 写法）
read_env() {
  ( set -a; . "$SHARED_DIR/.env" 2>/dev/null; set +a; printf '%s' "${!1:-}" )
}

# 从 release 的 BUILD_INFO 读取字段
read_build_info() {   # read_build_info <key> [file]
  local file="${2:-$RELEASE_DIR/BUILD_INFO}"
  [ -f "$file" ] || return 1
  sed -n "s/^$1=//p" "$file" | head -1
}

verify_sha256() { echo "$2  $1" | sha256sum -c --quiet >/dev/null 2>&1; }

switch_current() {   # switch_current <release-dir>
  as_app ln -sfn "$1" "$APP_ROOT/current.new"
  as_app mv -Tf "$APP_ROOT/current.new" "$APP_ROOT/current"
}

wait_healthy() {   # wait_healthy <name> <url> <timeout-seconds>
  local name="$1" url="$2" timeout="$3" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if curl -fsS -m 5 -o /dev/null "$url"; then ok "$name 健康检查通过"; return 0; fi
    sleep 2
    waited=$((waited + 2))
  done
  warn "$name 健康检查超时（${timeout}s）"
  return 1
}

check_prerequisites() {
  [ "$(id -u)" -eq 0 ] || die "请以 root 执行"
  id "$APP_USER" >/dev/null 2>&1 || die "用户 $APP_USER 不存在，请先执行 provision.sh"
  [ -d "$RELEASES_DIR" ] || die "$RELEASES_DIR 不存在，请先执行 provision.sh"
  [ -x /usr/local/bin/node ] || die "Node 未安装，请先执行 provision.sh"
  [ -s "$SHARED_DIR/.env" ] || die "$SHARED_DIR/.env 为空，请先写入环境变量"
  # ssh 进来时 cwd 是 /root，以 tyreflow 运行的命令读不了那里；统一切到应用目录
  cd "$APP_ROOT"
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^tyre-flow-'; then
    die "旧的 Docker 栈仍在运行（端口 3000/3333 会冲突）。请先执行: cd /root/deployment/tyre-flow && docker compose --profile external-db down"
  fi
}

# ---------- 1. 同步仓库（签名服务源码、排障用） ----------
sync_repo() {
  local sha="$1"
  if [ ! -d "$REPO_DIR/.git" ]; then
    log "初始化仓库 $REPO_DIR"
    as_app git init -q "$REPO_DIR"
  fi
  as_app git -C "$REPO_DIR" remote remove origin >/dev/null 2>&1 || true
  as_app git -C "$REPO_DIR" remote add origin "$REPO_URL"
  log "同步仓库到 ${sha:0:12}"
  as_app git -C "$REPO_DIR" fetch -q --prune origin "$sha"
  as_app git -C "$REPO_DIR" reset -q --hard FETCH_HEAD
}

# ---------- 2. 下载并校验产物 ----------
fetch_artifact() {
  local sha="$1" expected="${2:-}"
  local name="tyre-flow-${sha}.tar.zst"
  local url="${ARTIFACT_BASE_URL}/${name}"
  ARTIFACT_PATH="${TMP_DIR}/${name}"

  if [ -z "$expected" ]; then
    log "未提供 sha256，从 Release 读取 ${name}.sha256"
    expected="$(curl -fsSL --retry 3 --retry-delay 5 "${url}.sha256" | awk '{print $1}')"
    [ -n "$expected" ] || die "无法获取产物 sha256"
  fi

  if [ -f "$ARTIFACT_PATH" ] && verify_sha256 "$ARTIFACT_PATH" "$expected"; then
    ok "产物已在本地且校验通过，跳过下载"
    return
  fi

  log "下载产物 $url"
  local i
  for i in 1 2 3 4 5; do
    if as_app curl -fL -sS --retry 3 --retry-delay 5 -C - -o "$ARTIFACT_PATH" "$url"; then break; fi
    [ "$i" -lt 5 ] || die "产物下载失败"
    warn "下载失败，5 秒后重试 ($i/5)"
    sleep 5
  done
  verify_sha256 "$ARTIFACT_PATH" "$expected" || die "产物 sha256 校验失败"
  ok "产物下载完成（$(du -h "$ARTIFACT_PATH" | cut -f1)）"
}

# ---------- 3. 解压到新的 release 目录 ----------
extract_release() {
  local sha="$1"
  RELEASE_DIR="${RELEASES_DIR}/$(date +%Y%m%d%H%M%S)-${sha:0:12}"
  log "解压到 $RELEASE_DIR"
  as_app mkdir -p "$RELEASE_DIR"
  as_app tar --zstd -xf "$ARTIFACT_PATH" -C "$RELEASE_DIR"
  [ -f "$RELEASE_DIR/server.js" ] || die "产物缺少 server.js"
  [ -f "$RELEASE_DIR/BUILD_INFO" ] || die "产物缺少 BUILD_INFO"
}

# ---------- 4. prisma CLI（只在版本变化时安装，走 npm 与引擎镜像） ----------
ensure_prisma_cli() {
  local ver
  ver="$(read_build_info PRISMA_VERSION)"
  [ -n "$ver" ] || die "BUILD_INFO 缺少 PRISMA_VERSION"
  if [ -x "$TOOLS_DIR/node_modules/.bin/prisma" ] && [ "$(cat "$TOOLS_DIR/.prisma-version" 2>/dev/null)" = "$ver" ]; then
    ok "prisma CLI $ver 已就绪"
    return
  fi
  log "安装 prisma CLI $ver"
  [ -f "$TOOLS_DIR/package.json" ] || as_app sh -c "printf '{\"name\":\"tyre-flow-tools\",\"private\":true}\n' > '$TOOLS_DIR/package.json'"
  as_app env PRISMA_ENGINES_MIRROR="$PRISMA_ENGINES_MIRROR" npm_config_registry="$NPM_REGISTRY" \
    npm --prefix "$TOOLS_DIR" install --no-audit --no-fund --no-package-lock --save-exact "prisma@${ver}"
  as_app sh -c "echo '$ver' > '$TOOLS_DIR/.prisma-version'"
  ok "prisma CLI $ver 安装完成"
}

# ---------- 5. 数据库结构与种子数据 ----------
migrate_db() {
  local db_url
  db_url="$(read_env DATABASE_URL)"
  [ -n "$db_url" ] || die "$SHARED_DIR/.env 缺少 DATABASE_URL"
  # 与原 Dockerfile.migrate 一致：db push（生产库从未用过 prisma migrate）+ 幂等 seed
  log "同步数据库结构（prisma db push）"
  # 必须在 release 目录里执行：Prisma 6 会在 cwd 查找 prisma.config.ts，cwd 不可读会直接报错
  (cd "$RELEASE_DIR" && as_app env DATABASE_URL="$db_url" PRISMA_ENGINES_MIRROR="$PRISMA_ENGINES_MIRROR" \
    "$TOOLS_DIR/node_modules/.bin/prisma" db push \
      --schema prisma/schema.prisma --skip-generate --accept-data-loss)
  log "写入种子数据（seed）"
  (cd "$RELEASE_DIR" && as_app env DATABASE_URL="$db_url" NODE_ENV=production node prisma/seed.cjs)
}

# ---------- 6. 签名服务（依赖或代码变化时才重启） ----------
update_signature() {
  local src="$REPO_DIR/handwriting-simulator" venv="$APP_ROOT/signature/.venv"
  [ -f "$src/requirements.txt" ] || die "仓库缺少 handwriting-simulator/requirements.txt"
  [ -x "$venv/bin/pip" ] || die "签名服务 venv 不存在，请先执行 provision.sh"
  SIGNATURE_RESTART=0

  local req_hash
  req_hash="$(sha256sum "$src/requirements.txt" | cut -d' ' -f1)"
  if [ "$(cat "$venv/.requirements.sha256" 2>/dev/null)" != "$req_hash" ]; then
    log "安装签名服务 Python 依赖"
    as_app env PIP_INDEX_URL="$PIP_INDEX_URL" "$venv/bin/pip" install -q -r "$src/requirements.txt"
    as_app sh -c "echo '$req_hash' > '$venv/.requirements.sha256'"
    SIGNATURE_RESTART=1
  fi

  local prev_sha
  prev_sha="$(read_build_info GIT_SHA "$APP_ROOT/current/BUILD_INFO" 2>/dev/null || true)"
  if [ -z "$prev_sha" ] || ! as_app git -C "$REPO_DIR" diff --quiet "$prev_sha" "$NEW_SHA" -- handwriting-simulator 2>/dev/null; then
    SIGNATURE_RESTART=1
  fi
  if [ -f "$APP_ROOT/.units-changed" ]; then
    SIGNATURE_RESTART=1
    rm -f "$APP_ROOT/.units-changed"
  fi
  systemctl is-active -q tyre-flow-signature || SIGNATURE_RESTART=1
}

# ---------- 7. 切换与重启 ----------
activate_release() {
  PREVIOUS_DIR="$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)"
  if [ -n "$PREVIOUS_DIR" ] && [ -d "$PREVIOUS_DIR" ] && [ "$PREVIOUS_DIR" != "$RELEASE_DIR" ]; then
    as_app ln -sfn "$PREVIOUS_DIR" "$APP_ROOT/previous"
  fi
  switch_current "$RELEASE_DIR"
  ok "current -> $(basename "$RELEASE_DIR")"
}

restart_services() {
  if [ "$SIGNATURE_RESTART" = 1 ]; then
    log "重启签名服务"
    systemctl restart tyre-flow-signature
    wait_healthy "签名服务" "$SIGNATURE_HEALTH_URL" 60 || die "签名服务启动失败: $(journalctl -u tyre-flow-signature -n 30 --no-pager 2>&1 | tail -30)"
  else
    ok "签名服务无变化，不重启"
  fi
  log "重启 web 与 worker"
  systemctl restart tyre-flow-web tyre-flow-worker
}

verify_or_rollback() {
  if wait_healthy "web" "$WEB_HEALTH_URL" 90 && wait_healthy "worker" "$WORKER_HEALTH_URL" 90; then
    return 0
  fi
  warn "最近日志:"
  journalctl -u tyre-flow-web -u tyre-flow-worker -n 80 --no-pager || true
  if [ -n "${PREVIOUS_DIR:-}" ] && [ -d "$PREVIOUS_DIR" ]; then
    warn "自动回滚到 $(basename "$PREVIOUS_DIR")"
    switch_current "$PREVIOUS_DIR"
    systemctl restart tyre-flow-web tyre-flow-worker
    wait_healthy "web（回滚后）" "$WEB_HEALTH_URL" 90 || true
  fi
  die "部署失败"
}

# ---------- 8. 清理 ----------
prune_releases() {
  local keep_cur keep_prev d
  keep_cur="$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)"
  keep_prev="$(readlink -f "$APP_ROOT/previous" 2>/dev/null || true)"
  # 目录名以时间戳开头，倒序即最新在前
  for d in $(ls -1d "$RELEASES_DIR"/*/ 2>/dev/null | sort -r | tail -n +"$((KEEP_RELEASES + 1))"); do
    d="${d%/}"
    if [ "$d" = "$keep_cur" ] || [ "$d" = "$keep_prev" ]; then continue; fi
    log "清理旧 release $(basename "$d")"
    rm -rf "$d"
  done
  find "$TMP_DIR" -maxdepth 1 -name 'tyre-flow-*.tar.zst' ! -name "$(basename "$ARTIFACT_PATH")" -delete 2>/dev/null || true
}

# ============================================================
deploy() {
  NEW_SHA="${1:-}"
  local sha256="${2:-}"
  [ -n "$NEW_SHA" ] || die "用法: deploy.sh deploy <git-sha> [artifact-sha256]"
  check_prerequisites

  echo "========================================"
  echo " 部署 ${NEW_SHA:0:12}"
  echo "========================================"
  sync_repo "$NEW_SHA"
  fetch_artifact "$NEW_SHA" "$sha256"
  extract_release "$NEW_SHA"
  ensure_prisma_cli
  migrate_db
  update_signature
  activate_release
  restart_services
  verify_or_rollback
  prune_releases

  echo
  echo "========================================"
  echo " ✅ 部署完成: $(basename "$RELEASE_DIR")"
  echo "========================================"
  status
}

rollback() {
  [ "$(id -u)" -eq 0 ] || die "请以 root 执行"
  local prev cur
  prev="$(readlink -f "$APP_ROOT/previous" 2>/dev/null || true)"
  cur="$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)"
  { [ -n "$prev" ] && [ -d "$prev" ]; } || die "没有可回滚的 release"
  log "回滚: $(basename "$cur") -> $(basename "$prev")"
  switch_current "$prev"
  [ -n "$cur" ] && as_app ln -sfn "$cur" "$APP_ROOT/previous"
  systemctl restart tyre-flow-web tyre-flow-worker
  { wait_healthy "web" "$WEB_HEALTH_URL" 90 && wait_healthy "worker" "$WORKER_HEALTH_URL" 90; } || die "回滚后健康检查失败"
  ok "回滚完成"
  status
}

status() {
  echo
  echo "current : $(readlink "$APP_ROOT/current" 2>/dev/null || echo '-')"
  echo "previous: $(readlink "$APP_ROOT/previous" 2>/dev/null || echo '-')"
  [ -f "$APP_ROOT/current/BUILD_INFO" ] && sed 's/^/  /' "$APP_ROOT/current/BUILD_INFO"
  local u
  for u in tyre-flow-web tyre-flow-worker tyre-flow-signature; do
    printf '%-22s %s\n' "$u" "$(systemctl is-active "$u" 2>/dev/null || true)"
  done
  printf 'web health : %s\n' "$(curl -sS -m 5 "$WEB_HEALTH_URL" 2>&1 || true)"
  printf 'disk       : %s\n' "$(df -h / | awk 'NR==2{print $4 " free of " $2}')"
  printf 'memory     : %s\n' "$(free -m | awk 'NR==2{print $7 " MB available of " $2}')"
}

case "${1:-}" in
  deploy)   shift; deploy "$@" ;;
  rollback) rollback ;;
  status)   status ;;
  *)
    echo "用法: $0 deploy <git-sha> [artifact-sha256] | rollback | status" >&2
    exit 1
    ;;
esac
