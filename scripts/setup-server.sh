#!/bin/bash
set -e

# ============================================
# 服务器初始化脚本
# 首次部署前在本地执行，用于初始化服务器环境
#
# 使用方法:
#   ./scripts/setup-server.sh user@host
# ============================================

if [ -z "$1" ]; then
    echo "❌ 请提供服务器地址"
    echo "用法: ./scripts/setup-server.sh user@host"
    exit 1
fi

SERVER="$1"
SSH_PORT="${2:-22}"
REMOTE_DIR="~/deployment/tyer-flow"
REPO_URL="git@gitee.com:young91/tyre-flow.git"

echo "🔧 Tyer Flow 服务器初始化"
echo "========================================"
echo "📡 目标服务器: $SERVER"
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
ENDSSH

echo ""
echo "📂 创建项目目录并克隆代码..."

ssh -p $SSH_PORT $SERVER << ENDSSH
set -e

mkdir -p $REMOTE_DIR
cd $REMOTE_DIR

if [ ! -d ".git" ]; then
    echo "📦 克隆仓库..."
    git clone $REPO_URL .
else
    echo "✅ 仓库已存在"
fi

# 创建 .env 文件模板
if [ ! -f ".env" ]; then
    echo "📝 创建 .env 文件..."
    cat > .env << 'EOF'
# PostgreSQL 配置
POSTGRES_USER=tyer_flow
POSTGRES_PASSWORD=请设置安全密码
POSTGRES_DB=tyer_flow

# 应用配置
JWT_SECRET=请设置32位随机字符串
NEXTAUTH_SECRET=请设置另一个随机字符串
NEXTAUTH_URL=http://你的服务器IP:3000
EOF
    echo "⚠️  请编辑 $REMOTE_DIR/.env 配置环境变量"
else
    echo "✅ .env 文件已存在"
fi
ENDSSH

echo ""
echo "========================================"
echo "✅ 服务器初始化完成！"
echo ""
echo "📋 后续步骤:"
echo "   1. SSH 到服务器编辑环境变量:"
echo "      ssh $SERVER"
echo "      nano $REMOTE_DIR/.env"
echo ""
echo "   2. 首次部署（包含数据库迁移）:"
echo "      cd $REMOTE_DIR"
echo "      docker compose --profile setup up -d"
echo "      docker compose up -d"
echo ""
echo "   3. 之后使用一键部署脚本:"
echo "      ./scripts/deploy.sh $SERVER"
echo "========================================"

