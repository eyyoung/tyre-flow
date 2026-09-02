#!/usr/bin/env bash
# ============================================================
# Tyre Flow 生产服务器初始化脚本（幂等，可反复执行）
#
# 目标系统: Debian 12 (bookworm)。原 Docker 镜像 node:20-slim 同样基于 Debian 12，
# 所以 LibreOffice 7.4.7 与字体直接用 apt 安装即可，版本与原镜像完全一致。
#
# 每一项都是「先检查、缺什么装什么」，已满足的直接跳过；
# GitHub Actions 每次部署前都会先跑一遍，让机器收敛到期望状态。
#
# 用法（以 root 执行）:
#   ssh root@HOST 'bash -s' < scripts/server/provision.sh
#
# 可用环境变量覆盖: NODE_VERSION / SWAP_SIZE_GB
# ============================================================
set -euo pipefail

# ---------- 版本与来源 ----------
# Debian 12 自带的 Node 是 18，Next 16 要求 20.9+，所以从 npmmirror 装官方二进制
NODE_VERSION="${NODE_VERSION:-22.23.2}"
NODE_MIRROR="${NODE_MIRROR:-https://npmmirror.com/mirrors/node}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
PIP_INDEX_URL="${PIP_INDEX_URL:-https://mirrors.aliyun.com/pypi/simple/}"
SWAP_SIZE_GB="${SWAP_SIZE_GB:-2}"

# apt 包：与原 Dockerfile 的 runner 阶段一致（libreoffice-writer/calc + 三套字体），
# 外加运行脚本、签名服务与排障所需的工具
APT_PACKAGES=(
  ca-certificates curl git xz-utils zstd fontconfig
  python3 python3-venv python3-pip
  libreoffice-writer libreoffice-calc
  fonts-liberation fonts-wqy-zenhei fonts-wqy-microhei
  postgresql-client
)

# ---------- 目录与用户（deploy.sh 与 unit 文件依赖这些路径） ----------
APP_USER="tyreflow"
APP_ROOT="/opt/tyre-flow"
APP_HOME="${APP_ROOT}/home"

log() { printf '\033[0;34m[provision]\033[0m %s\n' "$*"; }
ok()  { printf '\033[0;32m[provision] ✔ %s\033[0m\n' "$*"; }
die() { printf '\033[0;31m[provision] ✘ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请以 root 执行"
if [ -r /etc/os-release ]; then
  . /etc/os-release
  [ "${ID:-}" = "debian" ] || die "只支持 Debian（当前: ${PRETTY_NAME:-unknown}）"
  [ "${VERSION_ID:-}" = "12" ] || log "注意: 脚本按 Debian 12 编写，当前是 ${PRETTY_NAME:-unknown}"
fi

WORK_DIR="$(mktemp -d /tmp/tyre-flow-provision.XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT

fetch() {   # fetch <url> <dest>，带重试与断点续传
  local url="$1" dest="$2" i
  for i in 1 2 3 4 5; do
    if curl -fL -sS --retry 3 --retry-delay 5 -C - -o "$dest" "$url"; then return 0; fi
    log "下载失败，5 秒后重试 ($i/5): $url"
    sleep 5
  done
  die "下载失败: $url"
}

pkg_installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'; }

# ---------- 1. 系统包 ----------
ensure_packages() {
  local missing=() p
  for p in "${APT_PACKAGES[@]}"; do pkg_installed "$p" || missing+=("$p"); done
  if [ ${#missing[@]} -eq 0 ]; then
    ok "系统包已齐全"
  else
    log "安装系统包: ${missing[*]}"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq --no-install-recommends "${missing[@]}"
    apt-get clean
  fi
  # 代码在 Linux 下调用的是 `libreoffice` 命令；顺便确认版本与原镜像一致（7.4）
  libreoffice --version 2>/dev/null | grep -q 'LibreOffice 7\.4' \
    || die "LibreOffice 版本不是 7.4（$(libreoffice --version 2>/dev/null || echo 未安装)），请确认系统是 Debian 12"
}

# ---------- 2. swap（1.8 GB 内存的保险，不用于构建） ----------
ensure_swap() {
  if [ -n "$(swapon --noheadings --show 2>/dev/null)" ]; then ok "swap 已启用"; return; fi
  if ! [ "$SWAP_SIZE_GB" -gt 0 ] 2>/dev/null; then log "SWAP_SIZE_GB=0，跳过 swap"; return; fi
  log "创建 ${SWAP_SIZE_GB}G swapfile"
  if [ ! -f /swapfile ]; then
    fallocate -l "${SWAP_SIZE_GB}G" /swapfile \
      || dd if=/dev/zero of=/swapfile bs=1M count=$((SWAP_SIZE_GB * 1024)) status=none
    chmod 600 /swapfile
    mkswap -q /swapfile
  fi
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  printf 'vm.swappiness = 10\n' > /etc/sysctl.d/90-tyre-flow.conf
  sysctl -q -p /etc/sysctl.d/90-tyre-flow.conf
  ok "swap 已启用"
}

# ---------- 3. 用户与目录 ----------
ensure_user_dirs() {
  if ! id "$APP_USER" >/dev/null 2>&1; then
    log "创建系统用户 $APP_USER"
    useradd --system --user-group --home-dir "$APP_HOME" --shell /usr/sbin/nologin "$APP_USER"
  fi
  install -d -o "$APP_USER" -g "$APP_USER" -m 755 \
    "$APP_ROOT" "$APP_ROOT/releases" "$APP_ROOT/tools" "$APP_ROOT/signature" "$APP_ROOT/tmp" \
    "$APP_ROOT/shared" "$APP_ROOT/shared/data" "$APP_ROOT/shared/data/iscc-exports"
  install -d -o "$APP_USER" -g "$APP_USER" -m 700 "$APP_HOME"

  # npm / pip 走国内镜像
  printf 'registry=%s\n' "$NPM_REGISTRY" > "$WORK_DIR/npmrc"
  install -o "$APP_USER" -g "$APP_USER" -m 644 "$WORK_DIR/npmrc" "$APP_HOME/.npmrc"
  install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$APP_HOME/.config" "$APP_HOME/.config/pip"
  printf '[global]\nindex-url = %s\n' "$PIP_INDEX_URL" > "$WORK_DIR/pip.conf"
  install -o "$APP_USER" -g "$APP_USER" -m 644 "$WORK_DIR/pip.conf" "$APP_HOME/.config/pip/pip.conf"

  # 环境变量文件由 CI 写入；这里只保证存在且权限正确
  if [ ! -f "$APP_ROOT/shared/.env" ]; then
    install -o "$APP_USER" -g "$APP_USER" -m 600 /dev/null "$APP_ROOT/shared/.env"
    log "已创建空的 $APP_ROOT/shared/.env（部署前需写入环境变量）"
  fi
  ok "用户与目录就绪"
}

# ---------- 4. Node ----------
ensure_node() {
  if [ -x /usr/local/bin/node ] && [ "$(/usr/local/bin/node -v 2>/dev/null)" = "v${NODE_VERSION}" ]; then
    ok "Node v${NODE_VERSION} 已安装"
    return
  fi
  log "安装 Node v${NODE_VERSION}（${NODE_MIRROR}）"
  local tarball="node-v${NODE_VERSION}-linux-x64.tar.xz"
  fetch "${NODE_MIRROR}/v${NODE_VERSION}/${tarball}" "$WORK_DIR/$tarball"
  fetch "${NODE_MIRROR}/v${NODE_VERSION}/SHASUMS256.txt" "$WORK_DIR/SHASUMS256.txt"
  (cd "$WORK_DIR" && grep " ${tarball}$" SHASUMS256.txt | sha256sum -c --quiet) || die "Node 校验失败"
  install -d /usr/local/lib/nodejs
  rm -rf "/usr/local/lib/nodejs/node-v${NODE_VERSION}"
  tar -xJf "$WORK_DIR/$tarball" -C /usr/local/lib/nodejs
  mv "/usr/local/lib/nodejs/node-v${NODE_VERSION}-linux-x64" "/usr/local/lib/nodejs/node-v${NODE_VERSION}"
  local bin
  for bin in node npm npx corepack; do
    ln -sfn "/usr/local/lib/nodejs/node-v${NODE_VERSION}/bin/$bin" "/usr/local/bin/$bin"
  done
  ok "Node $(/usr/local/bin/node -v) 安装完成"
}

# ---------- 5. 签名服务 venv ----------
ensure_python_venv() {
  local venv="$APP_ROOT/signature/.venv" sys_ver venv_ver
  sys_ver="$(python3 --version 2>&1)"
  venv_ver="$("$venv/bin/python" --version 2>&1 || true)"
  if [ -x "$venv/bin/python" ] && [ "$venv_ver" = "$sys_ver" ]; then
    ok "签名服务 venv 已就绪（$venv_ver）"
    return
  fi
  log "创建签名服务 venv（$sys_ver）"
  rm -rf "$venv"
  runuser -u "$APP_USER" -- env HOME="$APP_HOME" python3 -m venv "$venv"
  runuser -u "$APP_USER" -- env HOME="$APP_HOME" "$venv/bin/pip" install -q --upgrade pip
  ok "venv 创建完成（依赖由 deploy.sh 按 requirements.txt 安装）"
}

# ---------- 6. systemd 服务 ----------
UNITS_CHANGED=0
install_unit() {   # install_unit <name> <src>
  local dst="/etc/systemd/system/$1"
  if [ -f "$dst" ] && cmp -s "$2" "$dst"; then return 0; fi
  install -m 644 "$2" "$dst"
  UNITS_CHANGED=1
  log "已写入 $dst"
}

ensure_units() {
  # 说明:
  # - EnvironmentFile（shared/.env）的优先级高于 Environment=，可以覆盖这里的默认值
  # - TZ=UTC 与原容器一致，避免切换后按月/按日统计的边界变化
  # - worker 的 MemoryMax/CPUQuota 对应原 compose 的 mem_limit/cpus
  cat > "$WORK_DIR/tyre-flow-web.service" <<EOF
[Unit]
Description=Tyre Flow web (Next.js standalone)
After=network-online.target tyre-flow-signature.service
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_ROOT}/current
Environment=NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 TZ=UTC
Environment=HOME=${APP_HOME}
Environment=HOSTNAME=0.0.0.0 PORT=3000
Environment=ISCC_EXPORT_DIR=${APP_ROOT}/shared/data/iscc-exports
Environment=SIGNATURE_SERVICE_URL=http://127.0.0.1:3333/generate
EnvironmentFile=${APP_ROOT}/shared/.env
ExecStart=/usr/local/bin/node server.js
Restart=always
RestartSec=3
TimeoutStopSec=30
LimitNOFILE=65536
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

  cat > "$WORK_DIR/tyre-flow-worker.service" <<EOF
[Unit]
Description=Tyre Flow ISCC export worker (Next.js standalone, ISCC_EXPORT_WORKER=true)
After=network-online.target tyre-flow-signature.service
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_ROOT}/current
Environment=NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 TZ=UTC
Environment=HOME=${APP_HOME}
Environment=HOSTNAME=127.0.0.1 PORT=3001
Environment=ISCC_EXPORT_WORKER=true ISCC_EXPORT_BATCH_SIZE=50
Environment=ISCC_EXPORT_DIR=${APP_ROOT}/shared/data/iscc-exports
Environment=SIGNATURE_SERVICE_URL=http://127.0.0.1:3333/generate
EnvironmentFile=${APP_ROOT}/shared/.env
ExecStart=/usr/local/bin/node server.js
Restart=always
RestartSec=3
TimeoutStopSec=30
LimitNOFILE=65536
MemoryMax=768M
CPUQuota=100%
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

  cat > "$WORK_DIR/tyre-flow-signature.service" <<EOF
[Unit]
Description=Tyre Flow handwriting signature service (Flask)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_ROOT}/repo/handwriting-simulator
Environment=HOME=${APP_HOME} HOST=127.0.0.1 PORT=3333 PYTHONUNBUFFERED=1
ExecStart=${APP_ROOT}/signature/.venv/bin/python server.py
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

  install_unit tyre-flow-web.service "$WORK_DIR/tyre-flow-web.service"
  install_unit tyre-flow-worker.service "$WORK_DIR/tyre-flow-worker.service"
  install_unit tyre-flow-signature.service "$WORK_DIR/tyre-flow-signature.service"
  if [ "$UNITS_CHANGED" = 1 ]; then
    systemctl daemon-reload
    touch "$APP_ROOT/.units-changed"     # deploy.sh 看到这个标记会重启签名服务
  fi
  systemctl enable -q tyre-flow-web tyre-flow-worker tyre-flow-signature
  ok "systemd 服务已注册（由 deploy.sh 负责启动/重启）"
}

summary() {
  echo
  echo "======================================"
  echo " 初始化完成"
  echo "======================================"
  echo " 系统        : ${PRETTY_NAME:-unknown}"
  echo " Node        : $(/usr/local/bin/node -v)"
  echo " LibreOffice : $(libreoffice --version 2>/dev/null | head -1)"
  echo " Python      : $("$APP_ROOT/signature/.venv/bin/python" --version 2>&1)"
  echo " swap        : $(swapon --noheadings --show 2>/dev/null | awk '{print $1, $3}' | head -1)"
  echo " 目录        : $APP_ROOT（用户 $APP_USER）"
  echo " env 文件    : $APP_ROOT/shared/.env"
  echo "======================================"
}

main() {
  log "开始初始化 $(hostname)（${PRETTY_NAME:-unknown}）"
  ensure_packages
  ensure_swap
  ensure_user_dirs
  ensure_node
  ensure_python_venv
  ensure_units
  summary
}

main "$@"
