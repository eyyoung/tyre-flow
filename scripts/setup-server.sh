#!/bin/bash
set -e

# ============================================
# 服务器初始化脚本
# 首次部署前在本地执行，用于初始化服务器环境
#
# 使用方法:
#   ./scripts/setup-server.sh user@host
#   ./scripts/setup-server.sh user@host --with-webhook    # 同时初始化 webhook 服务
#   ./scripts/setup-server.sh user@host -p 2222           # 指定 SSH 端口
# ============================================

if [ -z "$1" ]; then
    echo "❌ 请提供服务器地址"
    echo "用法: ./scripts/setup-server.sh user@host [--with-webhook] [-p port]"
    exit 1
fi

SERVER="$1"
SSH_PORT="22"
WITH_WEBHOOK=false

# 解析参数
shift  # 跳过第一个参数（服务器地址）
while [[ $# -gt 0 ]]; do
    case "$1" in
        --with-webhook|-w)
            WITH_WEBHOOK=true
            shift
            ;;
        -p|--port)
            SSH_PORT="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

REMOTE_DIR="/root/deployment/tyre-flow"
REPO_URL="git@gitee.com:young91/tyre-flow.git"

echo "🔧 Tyre Flow 服务器初始化"
echo "========================================"
echo "📡 目标服务器: $SERVER"
echo "🔗 Webhook 服务: $([ "$WITH_WEBHOOK" = true ] && echo "是" || echo "否")"
echo "========================================"
echo ""

read -p "确认初始化服务器 $SERVER? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ 已取消"
    exit 1
fi

echo ""
echo "📤 连接服务器..."

ssh -p $SSH_PORT $SERVER << 'ENDSSH'
set -e

echo "🔍 检查 Docker..."
if ! command -v docker &> /dev/null; then
    echo "📦 安装 Docker..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    echo "⚠️  Docker 已安装，请重新登录服务器使 docker 组生效"
else
    echo "✅ Docker 已安装: $(docker --version)"
fi

echo ""
echo "🔍 检查 Docker Compose..."
if ! docker compose version &> /dev/null; then
    echo "📦 安装 Docker Compose 插件..."
    sudo apt-get update
    sudo apt-get install -y docker-compose-plugin
else
    echo "✅ Docker Compose 已安装: $(docker compose version)"
fi

echo ""
echo "🔍 检查 Git..."
if ! command -v git &> /dev/null; then
    echo "📦 安装 Git..."
    sudo apt-get update
    sudo apt-get install -y git
else
    echo "✅ Git 已安装: $(git --version)"
fi

echo ""
echo "🔑 配置 SSH 密钥用于私有仓库..."

# 检查密钥是否存在
if [ -f ~/.ssh/id_rsa ]; then
    echo "✅ 发现 SSH 密钥: ~/.ssh/id_rsa"
    
    # 设置正确的权限
    chmod 600 ~/.ssh/id_rsa
    chmod 644 ~/.ssh/id_rsa.pub 2>/dev/null || true
    chmod 700 ~/.ssh
    
    # 配置 SSH config
    if ! grep -q "gitee.com" ~/.ssh/config 2>/dev/null; then
        echo "📝 配置 SSH config..."
        cat >> ~/.ssh/config << 'SSHCONFIG'

# Gitee
Host gitee.com
    HostName gitee.com
    User git
    IdentityFile ~/.ssh/id_rsa
    IdentitiesOnly yes
SSHCONFIG
        chmod 600 ~/.ssh/config
    else
        echo "✅ SSH config 已配置 gitee.com"
    fi
    
    # 添加 gitee.com 到 known_hosts（避免首次连接的确认提示）
    if ! grep -q "gitee.com" ~/.ssh/known_hosts 2>/dev/null; then
        echo "📝 添加 gitee.com 到 known_hosts..."
        ssh-keyscan -t rsa,ed25519 gitee.com >> ~/.ssh/known_hosts 2>/dev/null
    fi
    
    # 测试 SSH 连接
    echo "🔍 测试 Gitee SSH 连接..."
    if ssh -T git@gitee.com 2>&1 | grep -q "successfully"; then
        echo "✅ SSH 连接测试成功"
    else
        echo "⚠️  SSH 连接测试未确认成功，请手动验证"
        echo "    运行: ssh -T git@gitee.com"
    fi
else
    echo "⚠️  未找到 SSH 密钥 ~/.ssh/id_rsa"
    echo "    请先将密钥复制到服务器："
    echo "    scp ~/.ssh/id_rsa* $USER@\$(hostname):~/.ssh/"
fi
ENDSSH

echo ""
echo "📂 创建项目目录并克隆代码..."

# 从 SERVER 变量中提取 IP/主机名 (user@host -> host)
SERVER_HOST=$(echo "$SERVER" | cut -d'@' -f2)

# 检查服务器上是否已有 .env 文件，如果有则读取已有的密钥
echo "🔍 检查服务器上的现有配置..."
EXISTING_ENV=$(ssh -p $SSH_PORT $SERVER "cat $REMOTE_DIR/.env 2>/dev/null || echo ''")

if [ -n "$EXISTING_ENV" ]; then
    echo "✅ 发现已有 .env 文件，读取现有密钥..."
    
    # 从现有配置中提取密钥
    DEPLOY_SECRET=$(echo "$EXISTING_ENV" | grep "^DEPLOY_SECRET=" | cut -d'=' -f2 | tr -d '\r')
    JWT_SECRET=$(echo "$EXISTING_ENV" | grep "^JWT_SECRET=" | cut -d'=' -f2 | tr -d '\r')
    NEXTAUTH_SECRET=$(echo "$EXISTING_ENV" | grep "^NEXTAUTH_SECRET=" | cut -d'=' -f2 | tr -d '\r')
    
    # 如果某些密钥不存在，生成新的
    [ -z "$DEPLOY_SECRET" ] && DEPLOY_SECRET=$(openssl rand -hex 32) && echo "   生成新的 DEPLOY_SECRET"
    [ -z "$JWT_SECRET" ] && JWT_SECRET=$(openssl rand -hex 32) && echo "   生成新的 JWT_SECRET"
    [ -z "$NEXTAUTH_SECRET" ] && NEXTAUTH_SECRET=$(openssl rand -hex 32) && echo "   生成新的 NEXTAUTH_SECRET"
    
    echo "   DEPLOY_SECRET: ${DEPLOY_SECRET:0:8}..."
else
    echo "📝 未发现 .env 文件，生成新密钥..."
    DEPLOY_SECRET=$(openssl rand -hex 32)
    JWT_SECRET=$(openssl rand -hex 32)
    NEXTAUTH_SECRET=$(openssl rand -hex 32)
fi

ssh -p $SSH_PORT $SERVER << ENDSSH
set -e

mkdir -p $REMOTE_DIR
cd $REMOTE_DIR

if [ ! -d ".git" ]; then
    echo "📦 克隆仓库..."
    git clone $REPO_URL .
else
    echo "✅ 仓库已存在，更新代码..."
    git fetch origin
    git reset --hard origin/main
fi

# 创建或更新 .env 文件
if [ ! -f ".env" ]; then
    echo "📝 创建 .env 文件..."
    cat > .env << EOF
# ============================================
# 数据库配置
# ============================================
# 方式一：使用本地 Docker PostgreSQL（默认）
# 保持 DATABASE_URL 注释，使用下面的 POSTGRES_* 变量
POSTGRES_USER=tyre_flow
POSTGRES_PASSWORD=${DEPLOY_SECRET}
POSTGRES_DB=tyre_flow

# 方式二：使用外部数据库（如 RDS）
# 取消下行注释并填入 RDS 连接字符串，然后使用 external-db profile 启动
# DATABASE_URL=postgresql://user:password@rds-host:5432/database?schema=public

# ============================================
# 应用配置
# ============================================
JWT_SECRET=${JWT_SECRET}
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
NEXTAUTH_URL=http://${SERVER_HOST}:3000

# Cookie 安全设置
# 如果使用 HTTPS，设置为 true
# 如果使用 HTTP，设置为 false
SECURE_COOKIES=false

# ============================================
# Webhook 配置 (用于自动化部署)
# ============================================
DEPLOY_SECRET=${DEPLOY_SECRET}
WEBHOOK_PORT=9000
BRANCH=main
EOF
    echo "✅ .env 文件已创建"
else
    echo "✅ .env 文件已存在，保留现有配置"
    
    # 检查是否有 DEPLOY_SECRET 配置，如果没有则添加
    if ! grep -q "^DEPLOY_SECRET=" .env; then
        echo "📝 添加 Webhook 配置..."
        cat >> .env << EOF

# Webhook 配置 (用于自动化部署)
DEPLOY_SECRET=${DEPLOY_SECRET}
WEBHOOK_PORT=9000
BRANCH=main
EOF
    fi
fi
ENDSSH

# 如果需要初始化 webhook
if [ "$WITH_WEBHOOK" = true ]; then
    echo ""
    echo "🔗 安装 Webhook 服务到宿主机..."
    
    ssh -p $SSH_PORT $SERVER << ENDSSH
set -e
cd $REMOTE_DIR

# 设置环境变量并运行安装脚本
export DEPLOY_SECRET="${DEPLOY_SECRET}"
export PROJECT_DIR="$REMOTE_DIR"
export WEBHOOK_PORT=9000

bash scripts/webhook/install.sh
ENDSSH
fi

echo ""
echo "========================================"
echo "✅ 服务器初始化完成！"
echo ""
echo "📋 重要信息:"
echo "   部署密钥 (DEPLOY_SECRET): $DEPLOY_SECRET"
echo ""
echo "   请保存好此密钥！它用于触发 Webhook 部署"
echo ""
echo "📋 后续步骤:"
echo "   1. SSH 到服务器检查/编辑环境变量:"
echo "      ssh $SERVER"
echo "      nano $REMOTE_DIR/.env"
echo ""
echo "   2. 首次部署:"
echo ""
echo "      【使用本地 Docker 数据库（默认）】"
echo "      cd $REMOTE_DIR"
echo "      docker compose --profile setup up -d  # 初始化数据库"
echo "      docker compose up -d"
echo ""
echo "      【使用外部数据库（RDS）】"
echo "      # 先编辑 .env，取消 DATABASE_URL 注释并填入 RDS 连接字符串"
echo "      cd $REMOTE_DIR"
echo "      docker compose --profile external-db-setup up  # 初始化数据库"
echo "      docker compose --profile external-db up -d     # 启动应用"
echo ""
if [ "$WITH_WEBHOOK" = true ]; then
echo "   3. Webhook 已启动，使用以下命令触发部署:"
echo "      export DEPLOY_SECRET=$DEPLOY_SECRET"
echo "      ./scripts/deploy.sh --webhook http://$SERVER_HOST:9000"
echo ""
echo "   Webhook 服务管理:"
echo "      查看状态: ssh $SERVER 'systemctl status tyre-flow-webhook'"
echo "      查看日志: ssh $SERVER 'journalctl -u tyre-flow-webhook -f'"
echo "      部署日志: ssh $SERVER 'tail -f /var/log/tyre-flow-deploy.log'"
else
echo "   3. 安装 Webhook 服务（可选）:"
echo "      ssh $SERVER"
echo "      cd $REMOTE_DIR && DEPLOY_SECRET=<密钥> bash scripts/webhook/install.sh"
echo ""
echo "   4. 使用 Webhook 部署:"
echo "      export DEPLOY_SECRET=<你的密钥>"
echo "      ./scripts/deploy.sh --webhook http://$SERVER_HOST:9000"
fi
echo ""
echo "   传统 SSH 部署方式仍然可用:"
echo "      ./scripts/deploy.sh $SERVER"
echo "========================================"
