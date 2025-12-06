#!/bin/bash
set -e

# ============================================
# Tyer Flow 本地一键部署脚本
# 在本地执行此脚本，自动部署到远程服务器
# 
# 使用方法:
#   ./scripts/deploy.sh              # 使用默认配置部署
#   ./scripts/deploy.sh user@host    # 指定服务器部署
# ============================================

# 配置项（请根据实际情况修改）
DEFAULT_SERVER="root@212.129.242.30"  # 默认服务器，格式: user@host
SSH_PORT="22"                          # SSH 端口
REMOTE_DIR="~/deployment/tyre-flow"    # 服务器上的项目目录
REPO_URL="git@gitee.com:young91/tyre-flow.git"
BRANCH="main"

# 使用传入的服务器地址或默认值
SERVER="${1:-$DEFAULT_SERVER}"

echo "🚀 Tyer Flow 一键部署"
echo "========================================"
echo "📡 目标服务器: $SERVER"
echo "📂 远程目录: $REMOTE_DIR"
echo "🔀 分支: $BRANCH"
echo "📅 时间: $(date)"
echo "========================================"
echo ""

# 确认部署
read -p "确认部署到 $SERVER? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ 部署已取消"
    exit 1
fi

echo ""
echo "📤 连接服务器并执行部署..."

# SSH 到服务器执行部署命令
ssh -p $SSH_PORT $SERVER << ENDSSH
set -e
sudo ssh-agent bash
ssh-add ~/.ssh/id_rsa

echo "📂 进入项目目录..."
mkdir -p $REMOTE_DIR
cd $REMOTE_DIR

# 拉取/克隆代码
if [ -d ".git" ]; then
    echo "📥 拉取最新代码..."
    git fetch origin
    git reset --hard origin/$BRANCH
else
    echo "📦 克隆仓库..."
    git clone -b $BRANCH $REPO_URL .
fi

echo "🔨 构建 Docker 镜像..."
docker compose down || true
docker compose build --no-cache

echo "🚢 启动服务..."
docker compose up -d

# 等待服务启动
echo "⏳ 等待服务启动..."
sleep 10

# 检查服务状态
if docker compose ps | grep -q "Up"; then
    echo "✅ 服务运行正常"
    docker compose ps
else
    echo "❌ 服务启动失败"
    docker compose logs --tail=50
    exit 1
fi

# 清理
echo "🧹 清理旧镜像..."
docker image prune -f

echo ""
echo "========================================"
echo "✅ 部署完成！"
echo "========================================"
ENDSSH

echo ""
echo "🎉 本地部署脚本执行完毕！"
