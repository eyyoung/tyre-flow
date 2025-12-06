#!/bin/bash
set -e

# ============================================
# Tyer Flow 自动部署脚本
# 此脚本应放置在服务器上: /home/deploy/deploy.sh
# ============================================

PROJECT_DIR="/home/deploy/tyer-flow"
REPO_URL="git@github.com:你的用户名/tyer-flow.git"  # 请替换为你的仓库地址
BRANCH="main"

echo "🚀 开始部署 Tyer Flow..."
echo "📅 时间: $(date)"
echo "----------------------------------------"

cd $PROJECT_DIR

# 拉取最新代码
if [ -d ".git" ]; then
    echo "📥 拉取最新代码..."
    git fetch origin
    git reset --hard origin/$BRANCH
else
    echo "📦 克隆仓库..."
    git clone -b $BRANCH $REPO_URL .
fi

echo "🔨 重新构建 Docker 镜像..."
docker compose down

# 构建新镜像
docker compose build --no-cache

echo "🚢 启动服务..."
docker compose up -d

# 等待服务启动
echo "⏳ 等待服务启动..."
sleep 10

# 检查服务状态
if docker compose ps | grep -q "Up"; then
    echo "✅ 服务启动成功！"
else
    echo "❌ 服务启动失败，请检查日志"
    docker compose logs --tail=50
    exit 1
fi

# 清理旧镜像
echo "🧹 清理旧镜像..."
docker image prune -f

echo "----------------------------------------"
echo "✅ 部署完成！"
echo "📅 完成时间: $(date)"

