#!/usr/bin/env bash
# ============================================================
# 从本机部署 Tyre Flow 到生产服务器
#
# 为什么需要它：服务器从 GitHub 拉取构建产物走跨境链路，夜间约 10 MB/s，白天高峰只有几十 KB/s，
# 一次部署可能拖到几十分钟。本机通常有代理，从 GitHub 下载很快；本机到阿里云是国内链路，上传也快。
# 所以白天部署改为：CI 只构建并上传产物 → 本机下载 → scp 到服务器 → 远程执行 deploy.sh。
# Release 里还没有该提交的产物时，脚本会自己触发 Deploy workflow（mode=build-only）并等它上传完，
# 因此 git push 之后直接执行本脚本即可一键部署。
#
# 前提：
#   1. 本机 gh 已登录（gh auth status）。触发 CI 构建需要账号对仓库有写权限；产物已存在时只读权限即可
#   2. 本机能 ssh 到服务器 root（known_hosts 里是当前主机密钥；换过系统后先 ssh-keygen -R <ip>）
#
# 用法：
#   scripts/deploy-from-local.sh              部署 origin/main 最新提交（会先 git fetch）
#   scripts/deploy-from-local.sh <git-sha>    部署指定提交（触发构建时它必须是某个远程分支的最新提交）
#
# 环境变量：
#   DEPLOY_HOST=root@8.148.203.142   服务器
#   DEPLOY_SSH_OPTS="-i ~/.ssh/xx"   额外 ssh/scp 参数
#   AUTO_BUILD=0                     产物不存在时不触发 CI，直接报错
#   DRY_RUN=1                        只下载、校验、上传，不在服务器上执行部署
#
# 与 CI 完整部署的区别：这里不会重写服务器上的 shared/.env（那是 CI 从 GitHub Secrets 生成的）。
# 改过 Secrets 时请走一次 CI 的 full 模式。
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${DEPLOY_REPO:-eyyoung/tyre-flow}"
RELEASE_TAG="${DEPLOY_RELEASE_TAG:-deploy-artifacts}"
HOST="${DEPLOY_HOST:-root@8.148.203.142}"
REMOTE_TMP="/opt/tyre-flow/tmp"
REMOTE_LOCK="/opt/tyre-flow/deploy.lock"
CACHE_DIR="${DEPLOY_CACHE_DIR:-${TMPDIR:-/tmp}/tyre-flow-artifacts}"
DRY_RUN="${DRY_RUN:-0}"
# shellcheck disable=SC2206
SSH_OPTS=(-o ConnectTimeout=15 -o ServerAliveInterval=30 ${DEPLOY_SSH_OPTS:-})

log()  { printf '\033[0;34m[local-deploy]\033[0m %s\n' "$*"; }
ok()   { printf '\033[0;32m[local-deploy] ✔ %s\033[0m\n' "$*"; }
die()  { printf '\033[0;31m[local-deploy] ✘ %s\033[0m\n' "$*" >&2; exit 1; }

remote() { ssh "${SSH_OPTS[@]}" "$HOST" "$@"; }

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

# ---------- 0. 本机环境 ----------
for cmd in gh git ssh scp; do
  command -v "$cmd" >/dev/null 2>&1 || die "缺少命令: $cmd"
done
gh auth status >/dev/null 2>&1 || die "gh 未登录，先执行 gh auth login"

# ---------- 1. 解析要部署的提交 ----------
REF="${1:-origin/main}"
if [[ "$REF" =~ ^[0-9a-f]{40}$ ]]; then
  SHA="$REF"
  git -C "$ROOT" cat-file -e "$SHA^{commit}" 2>/dev/null || git -C "$ROOT" fetch -q origin
else
  log "git fetch origin"
  git -C "$ROOT" fetch -q origin
  SHA="$(git -C "$ROOT" rev-parse --verify "$REF^{commit}" 2>/dev/null)" || die "无法解析 $REF"
fi
git -C "$ROOT" cat-file -e "$SHA^{commit}" 2>/dev/null || die "本地没有提交 $SHA 的对象"
SHORT="${SHA:0:12}"
log "部署提交 $SHORT: $(git -C "$ROOT" log -1 --format='%s' "$SHA")"
LOCAL_HEAD="$(git -C "$ROOT" rev-parse HEAD)"
[ "$LOCAL_HEAD" = "$SHA" ] || log "提示: 本地 HEAD (${LOCAL_HEAD:0:12}) 不是要部署的提交，确认已经 push"

# ---------- 2. 产物不存在时触发 CI 构建（mode=build-only）并等待上传 ----------
NAME="tyre-flow-${SHA}.tar.zst"
asset_exists() {
  gh release view "$RELEASE_TAG" -R "$REPO" --json assets --jq '.assets[].name' 2>/dev/null | grep -qx "$NAME"
}
# 该提交最新的一次 Deploy run（可选：只看某时间之后创建的），输出 "<id> <status> <conclusion> <url>"
run_for_sha() {
  gh run list -R "$REPO" --workflow=deploy.yml --limit 20 \
    --json databaseId,headSha,status,conclusion,url,createdAt \
    --jq "[.[] | select(.headSha == \"$SHA\" and .createdAt >= \"${1:-}\")] | sort_by(.createdAt) | last | select(. != null)
          | \"\\(.databaseId) \\(.status) \\(.conclusion) \\(.url)\""
}

if asset_exists; then
  ok "Release 里已有产物 $NAME"
else
  RUN_ID=""; RUN_STATUS=""; RUN_CONCLUSION=""; RUN_URL=""
  RUN="$(run_for_sha || true)"
  [ -n "$RUN" ] && read -r RUN_ID RUN_STATUS RUN_CONCLUSION RUN_URL <<<"$RUN"
  if [ -n "$RUN_ID" ] && [ "$RUN_STATUS" != "completed" ]; then
    log "该提交已有 Deploy run 在进行: $RUN_URL"
  else
    [ "${AUTO_BUILD:-1}" = "1" ] \
      || die "Release 里没有 $NAME（AUTO_BUILD=0 不触发构建）。到 GitHub Actions 运行 Deploy，mode 选 build-only"
    # workflow_dispatch 只能按分支触发：找一个头指向该提交的远程分支
    BRANCH="$(git -C "$ROOT" for-each-ref --points-at "$SHA" --format='%(refname)' refs/remotes/origin \
      | sed 's#^refs/remotes/origin/##' | grep -vx 'HEAD' | head -1)"
    [ -n "$BRANCH" ] || die "提交 $SHORT 不是任何远程分支的最新提交，无法触发 CI 构建（先 push，或改为部署分支最新提交）"
    log "触发 CI 构建: Deploy (mode=build-only) @ $BRANCH"
    DISPATCHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    gh workflow run deploy.yml -R "$REPO" --ref "$BRANCH" -f mode=build-only \
      || die "触发失败：gh 当前账号需要对仓库有写权限（gh auth status 查看账号；用仓库所有者账号 gh auth login 后重试）"
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
      sleep 5
      RUN="$(run_for_sha "$DISPATCHED_AT" || true)"
      [ -n "$RUN" ] && break
    done
    [ -n "$RUN" ] || die "触发后 60 秒内没看到新的 run，去 GitHub Actions 页面确认"
    read -r RUN_ID RUN_STATUS RUN_CONCLUSION RUN_URL <<<"$RUN"
    log "run: $RUN_URL"
  fi
  # build-only 约 2 分钟。若在进行的是 full 模式的 run，它上传产物后会自己去部署，这里会在部署锁上被拦住
  started=$(date +%s)
  while ! asset_exists; do
    STATE="$(gh run view "$RUN_ID" -R "$REPO" --json status,conclusion --jq '"\(.status) \(.conclusion)"' 2>/dev/null || echo unknown)"
    case "$STATE" in
      "completed success") die "run 已成功结束但 Release 里没有 $NAME: $RUN_URL" ;;
      completed*) die "CI 构建失败（$STATE）: $RUN_URL" ;;
    esac
    printf '\r[local-deploy] 等待 CI 构建并上传产物… %ds (%s)' "$(( $(date +%s) - started ))" "${STATE% *}"
    sleep 15
  done
  echo
  ok "产物已上传，等待 $(( $(date +%s) - started )) s"
fi

# ---------- 3. 下载并校验（有缓存且校验通过则跳过） ----------
mkdir -p "$CACHE_DIR"
ARTIFACT="$CACHE_DIR/$NAME"
gh release download "$RELEASE_TAG" -R "$REPO" --pattern "$NAME.sha256" --dir "$CACHE_DIR" --clobber
EXPECTED="$(awk '{print $1}' "$ARTIFACT.sha256")"
[ -n "$EXPECTED" ] || die "sha256 文件为空"
if [ -f "$ARTIFACT" ] && [ "$(sha256_of "$ARTIFACT")" = "$EXPECTED" ]; then
  ok "本机缓存已有产物且校验通过: $ARTIFACT"
else
  log "下载产物 $NAME"
  started=$(date +%s)
  gh release download "$RELEASE_TAG" -R "$REPO" --pattern "$NAME" --dir "$CACHE_DIR" --clobber
  [ "$(sha256_of "$ARTIFACT")" = "$EXPECTED" ] || die "产物 sha256 校验失败"
  ok "下载完成 $(du -h "$ARTIFACT" | cut -f1)，用时 $(( $(date +%s) - started )) s"
fi

# ---------- 4. 服务器检查：目录已 provision、没有别的部署在跑 ----------
remote "test -d $REMOTE_TMP" || die "服务器上没有 $REMOTE_TMP，先跑一次 CI 完整部署完成初始化"
remote "flock -n $REMOTE_LOCK true" \
  || die "服务器上有另一个部署正在进行（多半是 CI 的 Deploy 卡在下载）。到 GitHub Actions 取消那个 run 后重试"

# ---------- 5. 上传（服务器上已有同样文件则跳过） ----------
if remote "echo '$EXPECTED  $REMOTE_TMP/$NAME' | sha256sum -c --quiet >/dev/null 2>&1"; then
  ok "服务器上已有产物且校验通过，跳过上传"
else
  log "上传产物到 $HOST:$REMOTE_TMP"
  started=$(date +%s)
  scp "${SSH_OPTS[@]}" -q "$ARTIFACT" "$HOST:$REMOTE_TMP/$NAME.uploading"
  remote "mv -f '$REMOTE_TMP/$NAME.uploading' '$REMOTE_TMP/$NAME' && chown tyreflow:tyreflow '$REMOTE_TMP/$NAME' \
    && echo '$EXPECTED  $REMOTE_TMP/$NAME' | sha256sum -c --quiet" || die "上传后校验失败"
  ok "上传完成，用时 $(( $(date +%s) - started )) s"
fi

if [ "$DRY_RUN" = "1" ]; then
  ok "DRY_RUN=1：产物已就位，未执行部署。正式部署命令: $0 $SHA"
  exit 0
fi

# ---------- 6. 远程 provision + deploy（脚本取自被部署的那个提交，与 CI 一致） ----------
log "provision（幂等）"
git -C "$ROOT" show "$SHA:scripts/server/provision.sh" | remote 'bash -s'
log "deploy"
git -C "$ROOT" show "$SHA:scripts/server/deploy.sh" | remote "bash -s -- deploy '$SHA' '$EXPECTED'"

# ---------- 7. 公网冒烟 ----------
HOST_IP="${HOST#*@}"
if curl -fsS --retry 3 --retry-delay 5 -m 10 "http://$HOST_IP:3000/api/health"; then
  echo; ok "部署完成: $SHORT"
else
  echo; die "公网健康检查失败（服务可能已回滚，查看上面的 deploy 日志）"
fi
