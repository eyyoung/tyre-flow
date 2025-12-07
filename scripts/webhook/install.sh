#!/bin/bash
set -e

# ============================================
# 在宿主机上安装 Webhook 服务
# 直接运行在宿主机，可以访问 SSH 密钥和 Docker
# ============================================

INSTALL_DIR="/opt/webhook"
SERVICE_NAME="tyre-flow-webhook"
WEBHOOK_PORT="${WEBHOOK_PORT:-9000}"
DEPLOY_SECRET="${DEPLOY_SECRET:-}"
PROJECT_DIR="${PROJECT_DIR:-/root/deployment/tyre-flow}"

echo "🔧 安装 Webhook 服务到宿主机"
echo "========================================"

# 如果服务已存在，先停止并删除
if systemctl is-active --quiet ${SERVICE_NAME} 2>/dev/null; then
    echo "🛑 停止已存在的服务..."
    systemctl stop ${SERVICE_NAME}
fi

if [ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]; then
    echo "🗑️  删除旧服务配置..."
    systemctl disable ${SERVICE_NAME} 2>/dev/null || true
    rm -f /etc/systemd/system/${SERVICE_NAME}.service
    systemctl daemon-reload
fi

# 检测系统架构
ARCH=$(uname -m)
case $ARCH in
    x86_64) ARCH="amd64" ;;
    aarch64) ARCH="arm64" ;;
    armv7l) ARCH="armhf" ;;
esac

OS=$(uname -s | tr '[:upper:]' '[:lower:]')

echo "📦 系统: $OS/$ARCH"

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 安装 webhook
if ! command -v webhook &> /dev/null; then
    mkdir -p $INSTALL_DIR
    
    # 检查本地是否有预置的 tar.gz 文件
    LOCAL_TAR="$SCRIPT_DIR/webhook-${OS}-${ARCH}.tar.gz"
    
    if [ -f "$LOCAL_TAR" ]; then
        echo "📦 使用本地预置的 webhook..."
        cd /tmp
        tar -xzf "$LOCAL_TAR"
        mv webhook-${OS}-${ARCH}/webhook $INSTALL_DIR/
        rm -rf webhook-${OS}-${ARCH}
    else
        echo "📥 下载 webhook..."
        WEBHOOK_VERSION="2.8.1"
        WEBHOOK_URL="https://github.com/adnanh/webhook/releases/download/${WEBHOOK_VERSION}/webhook-${OS}-${ARCH}.tar.gz"
        
        cd /tmp
        curl -sL "$WEBHOOK_URL" -o webhook.tar.gz
        tar -xzf webhook.tar.gz
        mv webhook-${OS}-${ARCH}/webhook $INSTALL_DIR/
        rm -rf webhook.tar.gz webhook-${OS}-${ARCH}
    fi
    
    chmod +x $INSTALL_DIR/webhook
    
    # 添加到 PATH
    ln -sf $INSTALL_DIR/webhook /usr/local/bin/webhook
    echo "✅ Webhook 已安装到 $INSTALL_DIR"
else
    echo "✅ Webhook 已存在: $(which webhook)"
fi

# 创建配置目录
mkdir -p $INSTALL_DIR/scripts

# 生成 hooks.json
echo "📝 生成配置文件..."

if [ -z "$DEPLOY_SECRET" ]; then
    echo "⚠️  警告: 未设置 DEPLOY_SECRET，webhook 将无需认证！"
    cat > $INSTALL_DIR/hooks.json << 'EOF'
[
  {
    "id": "deploy",
    "execute-command": "/opt/webhook/scripts/deploy.sh",
    "command-working-directory": "/opt/webhook",
    "response-message": "Deploy triggered",
    "include-command-output-in-response": true
  },
  {
    "id": "health",
    "execute-command": "/bin/echo",
    "response-message": "OK"
  }
]
EOF
else
    cat > $INSTALL_DIR/hooks.json << EOF
[
  {
    "id": "deploy",
    "execute-command": "/opt/webhook/scripts/deploy.sh",
    "command-working-directory": "/opt/webhook",
    "response-message": "Deploy triggered",
    "include-command-output-in-response": true,
    "trigger-rule-mismatch-http-response-code": 403,
    "trigger-rule": {
      "match": {
        "type": "value",
        "value": "${DEPLOY_SECRET}",
        "parameter": {
          "source": "url",
          "name": "token"
        }
      }
    }
  },
  {
    "id": "health",
    "execute-command": "/bin/echo",
    "response-message": "OK"
  }
]
EOF
fi

# 生成部署脚本
cat > $INSTALL_DIR/scripts/deploy.sh << EOF
#!/bin/bash
set -e

LOG_FILE="/var/log/tyre-flow-deploy.log"
PROJECT_DIR="$PROJECT_DIR"
BRANCH="\${BRANCH:-main}"

log() {
    echo "[\$(date '+%Y-%m-%d %H:%M:%S')] \$1" | tee -a "\$LOG_FILE"
}

log "========================================="
log "🚀 开始部署..."
log "========================================="

cd "\$PROJECT_DIR"

log "📥 拉取最新代码..."
git fetch origin
git reset --hard origin/\$BRANCH

log "🔨 重新构建应用..."
docker compose build app

log "🚢 重启应用服务..."
docker compose up -d app

log "⏳ 等待服务启动..."
sleep 10

if docker compose ps app | grep -q "Up"; then
    log "✅ 部署成功！"
else
    log "❌ 部署失败！"
    docker compose logs --tail=50 app >> "\$LOG_FILE"
    exit 1
fi

log "🧹 清理旧镜像..."
docker image prune -f >> "\$LOG_FILE" 2>&1 || true

log "========================================="
log "✅ 部署完成！"
log "========================================="

echo "Deploy completed at \$(date)"
EOF

chmod +x $INSTALL_DIR/scripts/deploy.sh

# 创建 systemd 服务
echo "📝 创建 systemd 服务..."
cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=Tyre Flow Webhook Service
After=network.target docker.service

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/webhook -verbose -hooks=$INSTALL_DIR/hooks.json -port=$WEBHOOK_PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# 启动服务
echo "🚀 启动服务..."
systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
systemctl restart ${SERVICE_NAME}

sleep 2

if systemctl is-active --quiet ${SERVICE_NAME}; then
    echo ""
    echo "========================================"
    echo "✅ Webhook 服务已启动！"
    echo ""
    echo "📋 服务状态: systemctl status ${SERVICE_NAME}"
    echo "📋 查看日志: journalctl -u ${SERVICE_NAME} -f"
    echo "📋 部署日志: tail -f /var/log/tyre-flow-deploy.log"
    echo ""
    echo "🔗 端点:"
    echo "   健康检查: http://localhost:${WEBHOOK_PORT}/hooks/health"
    echo "   触发部署: http://localhost:${WEBHOOK_PORT}/hooks/deploy?token=<secret>"
    echo "========================================"
else
    echo "❌ 服务启动失败"
    systemctl status ${SERVICE_NAME}
    exit 1
fi

