#!/bin/bash

# ===========================================
# 本地部署脚本
# 用法: ./scripts/deploy.sh [dev|prod] [--scp]
#
# 选项:
#   --scp  使用传统 SCP 方式传输（默认使用 Registry 增量推送）
# ===========================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
    exit 1
}

# 检查参数
if [ -z "$1" ]; then
    echo "用法: $0 [dev|prod] [--scp]"
    echo ""
    echo "  dev   - 部署到测试环境 (212.129.242.30)"
    echo "  prod  - 部署到生产环境 (8.148.203.142)"
    echo ""
    echo "选项:"
    echo "  --scp - 使用传统 SCP 方式传输完整镜像（默认使用 Registry 增量推送）"
    exit 1
fi

ENV=$1
USE_SCP=false

# 解析额外参数
shift
while [[ $# -gt 0 ]]; do
    case $1 in
        --scp)
            USE_SCP=true
            shift
            ;;
        *)
            error "未知参数: $1"
            ;;
    esac
done

# Registry 配置（在服务器上运行）
REGISTRY_PORT="5000"

# 配置变量
case $ENV in
    dev)
        SERVER_IP="212.129.242.30"
        SERVER_USER="root"
        DEPLOY_DIR="/root/deployment/tyre-flow"
        GIT_BRANCH="main"
        DOCKER_PROFILE="internal-db"
        SETUP_PROFILE="setup"
        MIGRATE_SERVICE="migrate"
        REGISTRY_HOST="${SERVER_IP}:${REGISTRY_PORT}"
        ;;
    prod)
        SERVER_IP="8.148.203.142"
        SERVER_USER="root"
        DEPLOY_DIR="/root/deployment/tyre-flow"
        GIT_BRANCH="main"
        DOCKER_PROFILE="external-db"
        SETUP_PROFILE="external-db-setup"
        MIGRATE_SERVICE="migrate-external-db"
        REGISTRY_HOST="${SERVER_IP}:${REGISTRY_PORT}"
        ;;
    *)
        error "未知环境: $ENV (请使用 dev 或 prod)"
        ;;
esac

# 获取当前 Git commit short SHA
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")

echo ""
echo "========================================"
echo "🚀 部署到 $ENV 环境"
echo "========================================"
echo "服务器: ${SERVER_USER}@${SERVER_IP}"
echo "部署目录: ${DEPLOY_DIR}"
echo "Git SHA: ${GIT_SHA}"
echo "Docker Profile: ${DOCKER_PROFILE}"
if [ "$USE_SCP" = true ]; then
    echo "传输方式: SCP（完整镜像）"
else
    echo "传输方式: Registry（增量推送）🚀"
    echo "Registry: ${REGISTRY_HOST}"
fi
echo "========================================"
echo ""

# 确认部署
read -p "确认部署到 $ENV 环境? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    info "部署已取消"
    exit 0
fi

# ===========================================
# Registry 模式预检查
# ===========================================
if [ "$USE_SCP" = false ]; then
    info "🔍 检查 Docker 配置..."
    
    # 检查本地 Docker 是否配置了 insecure-registries
    DOCKER_CONFIG_OK=false
    
    # 检查 daemon.json
    if [ -f "/etc/docker/daemon.json" ]; then
        if grep -q "${REGISTRY_HOST}" /etc/docker/daemon.json 2>/dev/null; then
            DOCKER_CONFIG_OK=true
        fi
    fi
    
    # macOS: 检查 Docker Desktop 配置
    if [ -f "$HOME/.docker/daemon.json" ]; then
        if grep -q "${REGISTRY_HOST}" "$HOME/.docker/daemon.json" 2>/dev/null; then
            DOCKER_CONFIG_OK=true
        fi
    fi
    
    if [ "$DOCKER_CONFIG_OK" = false ]; then
        warn "检测到本地 Docker 可能未配置 insecure-registries"
        echo ""
        echo "📝 请将以下内容添加到 Docker 配置中："
        echo ""
        echo "   macOS/Windows (Docker Desktop):"
        echo "   Settings -> Docker Engine -> 添加："
        echo ""
        echo "   {\"insecure-registries\": [\"${REGISTRY_HOST}\"]}"
        echo ""
        echo "   Linux (/etc/docker/daemon.json):"
        echo "   {\"insecure-registries\": [\"${REGISTRY_HOST}\"]}"
        echo ""
        echo "   然后重启 Docker 服务"
        echo ""
        read -p "配置完成后按 Enter 继续，或输入 'skip' 跳过检查: " SKIP_CHECK
        if [ "$SKIP_CHECK" != "skip" ]; then
            info "请完成配置后重新运行部署脚本"
            info "或使用 --scp 选项使用传统传输方式"
            exit 0
        fi
    else
        success "Docker insecure-registries 已配置"
    fi
fi

# ===========================================
# 阶段1: 构建 Docker 镜像
# ===========================================
info "🏗️  开始构建 Docker 镜像..."

# 根据传输方式决定镜像标签
if [ "$USE_SCP" = true ]; then
    APP_IMAGE="tyre-flow-app:latest"
    MIGRATE_IMAGE="tyre-flow-migrate:latest"
else
    APP_IMAGE="${REGISTRY_HOST}/tyre-flow-app:${GIT_SHA}"
    APP_IMAGE_LATEST="${REGISTRY_HOST}/tyre-flow-app:latest"
    MIGRATE_IMAGE="${REGISTRY_HOST}/tyre-flow-migrate:${GIT_SHA}"
    MIGRATE_IMAGE_LATEST="${REGISTRY_HOST}/tyre-flow-migrate:latest"
fi

# 构建应用镜像
info "构建应用镜像..."
if [ "$USE_SCP" = true ]; then
    docker build --platform linux/amd64 -t "$APP_IMAGE" .
else
    docker build --platform linux/amd64 -t "$APP_IMAGE" -t "$APP_IMAGE_LATEST" .
fi

# 构建迁移镜像
info "构建迁移镜像..."
if [ "$USE_SCP" = true ]; then
    docker build --platform linux/amd64 -f Dockerfile.migrate -t "$MIGRATE_IMAGE" .
else
    docker build --platform linux/amd64 -f Dockerfile.migrate -t "$MIGRATE_IMAGE" -t "$MIGRATE_IMAGE_LATEST" .
fi

success "镜像构建完成"
docker images | grep tyre-flow

if [ "$USE_SCP" = true ]; then
    # ===========================================
    # SCP 模式: 保存并传输完整镜像
    # ===========================================
    info "📦 保存镜像为 tar 文件..."

    TEMP_FILE=$(mktemp /tmp/tyre-flow-app.XXXXXX.tar.gz)
    docker save tyre-flow-app:latest | gzip > "$TEMP_FILE"

    TEMP_MIGRATE_FILE=$(mktemp /tmp/tyre-flow-migrate.XXXXXX.tar.gz)
    docker save tyre-flow-migrate:latest | gzip > "$TEMP_MIGRATE_FILE"

    ls -lh "$TEMP_FILE" "$TEMP_MIGRATE_FILE"
    success "镜像保存完成"

    info "📤 传输镜像到服务器 (${SERVER_IP})..."

    scp -o StrictHostKeyChecking=no "$TEMP_FILE" "${SERVER_USER}@${SERVER_IP}:/tmp/tyre-flow-app.tar.gz"
    scp -o StrictHostKeyChecking=no "$TEMP_MIGRATE_FILE" "${SERVER_USER}@${SERVER_IP}:/tmp/tyre-flow-migrate.tar.gz"

    success "镜像传输完成"

    # 清理本地临时文件
    rm -f "$TEMP_FILE" "$TEMP_MIGRATE_FILE"
else
    # ===========================================
    # Registry 模式: 增量推送到远程 Registry
    # ===========================================
    
    # 确保服务器上 Registry 正在运行
    info "🔧 确保远程 Registry 服务运行中..."
    ssh -o StrictHostKeyChecking=no "${SERVER_USER}@${SERVER_IP}" << 'REGISTRY_SETUP'
set -e
# 检查 registry 是否运行
if ! docker ps --format '{{.Names}}' | grep -q "^registry$"; then
    echo "启动 Docker Registry..."
    docker run -d \
        --name registry \
        --restart=always \
        -p 5000:5000 \
        -v /var/lib/registry:/var/lib/registry \
        registry:2
    echo "Registry 已启动"
else
    echo "Registry 已在运行"
fi
REGISTRY_SETUP
    
    success "Registry 服务就绪"

    # 配置本地 Docker 信任该 Registry（insecure registry）
    info "📤 推送镜像到 Registry（增量传输）..."
    
    # 推送应用镜像
    info "推送应用镜像 (只传输变化的层)..."
    docker push "$APP_IMAGE"
    docker push "$APP_IMAGE_LATEST"
    
    # 推送迁移镜像
    info "推送迁移镜像 (只传输变化的层)..."
    docker push "$MIGRATE_IMAGE"
    docker push "$MIGRATE_IMAGE_LATEST"
    
    success "镜像推送完成（增量传输）"
fi

# ===========================================
# 阶段4: 在服务器上部署
# ===========================================
info "🚀 在服务器上执行部署..."

# 根据传输模式设置镜像加载命令
if [ "$USE_SCP" = true ]; then
    LOAD_IMAGES_CMD='
echo "📥 加载 Docker 镜像..."
docker load < /tmp/tyre-flow-app.tar.gz
rm -f /tmp/tyre-flow-app.tar.gz

echo "📥 加载迁移镜像..."
docker load < /tmp/tyre-flow-migrate.tar.gz
rm -f /tmp/tyre-flow-migrate.tar.gz
'
else
    LOAD_IMAGES_CMD="
echo \"📥 从 Registry 拉取镜像（增量下载）...\"
docker pull localhost:${REGISTRY_PORT}/tyre-flow-app:latest
docker pull localhost:${REGISTRY_PORT}/tyre-flow-migrate:latest

echo \"📥 重新标记镜像...\"
docker tag localhost:${REGISTRY_PORT}/tyre-flow-app:latest tyre-flow-app:latest
docker tag localhost:${REGISTRY_PORT}/tyre-flow-migrate:latest tyre-flow-migrate:latest
"
fi

if [ "$ENV" = "dev" ]; then
    # Dev 环境部署脚本
    ssh -o StrictHostKeyChecking=no "${SERVER_USER}@${SERVER_IP}" << DEPLOY_SCRIPT
set -e

echo "📂 进入项目目录..."
DEPLOY_DIR="${DEPLOY_DIR}"
mkdir -p \$DEPLOY_DIR
cd \$DEPLOY_DIR

${LOAD_IMAGES_CMD}

echo "📥 同步配置文件..."
if [ -d ".git" ]; then
  git fetch origin
  git reset --hard origin/${GIT_BRANCH}
else
  git clone -b ${GIT_BRANCH} https://cnb.cool/tyre-flow/tyre-flow.git .
fi

# 检测是否是首次部署（检查数据库容器是否存在）
FIRST_DEPLOY=false
if ! docker ps -a --format '{{.Names}}' | grep -q "tyre-flow-db"; then
  echo "🆕 检测到首次部署，将初始化数据库..."
  FIRST_DEPLOY=true
fi

echo "🚢 停止旧服务..."
docker compose down || true

if [ "\$FIRST_DEPLOY" = true ]; then
  echo "🗄️ 首次部署：启动数据库服务..."
  docker compose up -d db
  
  echo "⏳ 等待数据库就绪..."
  for i in {1..30}; do
    if docker compose exec -T db pg_isready -U tyre_flow > /dev/null 2>&1; then
      echo "✅ 数据库已就绪"
      break
    fi
    echo "   等待数据库... (\$i/30)"
    sleep 2
  done
  
  echo "📊 运行数据库迁移和初始化..."
  docker compose --profile ${SETUP_PROFILE} run --rm ${MIGRATE_SERVICE}
  
  echo "🚀 启动应用服务..."
  docker compose --profile ${DOCKER_PROFILE} up -d --no-build
else
  echo "🔄 更新部署：启动所有服务..."
  docker compose --profile ${DOCKER_PROFILE} up -d --no-build
  
  echo "⏳ 等待服务启动..."
  sleep 10
  
  echo "📊 运行数据库迁移（如有更新）..."
  docker compose --profile ${SETUP_PROFILE} run --rm ${MIGRATE_SERVICE} || echo "迁移已完成或无更新"
fi

echo "⏳ 等待服务完全启动..."
sleep 5

echo "🔍 检查服务状态..."
if docker compose ps | grep -q "Up"; then
  echo "✅ 服务运行正常"
  docker compose ps
else
  echo "❌ 服务启动失败"
  docker compose logs --tail=50
  exit 1
fi

echo "🧹 清理旧镜像..."
docker image prune -f

echo ""
echo "========================================"
echo "✅ 部署完成！"
echo "========================================"
DEPLOY_SCRIPT

else
    # Prod 环境部署脚本
    ssh -o StrictHostKeyChecking=no "${SERVER_USER}@${SERVER_IP}" << DEPLOY_SCRIPT
set -e

echo "📂 进入项目目录..."
DEPLOY_DIR="${DEPLOY_DIR}"
mkdir -p \$DEPLOY_DIR
cd \$DEPLOY_DIR

${LOAD_IMAGES_CMD}

echo "📥 同步配置文件..."
if [ -d ".git" ]; then
  git fetch origin
  git reset --hard origin/${GIT_BRANCH}
else
  git clone -b ${GIT_BRANCH} https://cnb.cool/tyre-flow/tyre-flow.git .
fi

# 检测是否是首次部署（应用容器不存在）
FIRST_DEPLOY=false
if ! docker ps -a --format '{{.Names}}' | grep -q "tyre-flow-app"; then
  echo "🆕 检测到首次部署..."
  FIRST_DEPLOY=true
fi

echo "🚢 停止旧服务..."
docker compose --profile ${DOCKER_PROFILE} down || true

if [ "\$FIRST_DEPLOY" = true ]; then
  echo "📊 首次部署：运行数据库迁移和初始化..."
  docker compose --profile ${SETUP_PROFILE} run --rm ${MIGRATE_SERVICE}
fi

echo "🚀 启动应用服务（外部数据库模式）..."
docker compose --profile ${DOCKER_PROFILE} up -d --no-build

echo "⏳ 等待服务启动..."
sleep 10

if [ "\$FIRST_DEPLOY" = false ]; then
  echo "📊 运行数据库迁移（如有更新）..."
  docker compose --profile ${SETUP_PROFILE} run --rm ${MIGRATE_SERVICE} || echo "迁移已完成或无更新"
fi

echo "🔍 检查服务状态..."
if docker compose --profile ${DOCKER_PROFILE} ps | grep -q "Up"; then
  echo "✅ 服务运行正常"
  docker compose --profile ${DOCKER_PROFILE} ps
else
  echo "❌ 服务启动失败"
  docker compose --profile ${DOCKER_PROFILE} logs --tail=50
  exit 1
fi

echo "🧹 清理旧镜像..."
docker image prune -f

echo ""
echo "========================================"
echo "✅ 生产环境部署完成！（外部数据库模式）"
echo "========================================"
DEPLOY_SCRIPT

fi

success "🎉 部署脚本执行完成！"
