#!/bin/bash
set -e

# ============================================
# Tyre Flow 部署脚本
# 支持两种部署模式:
#   1. SSH 模式: 直接 SSH 到服务器执行部署
#   2. Webhook 模式: 通过 HTTP 请求触发服务器上的部署
# 
# 使用方法:
#   ./scripts/deploy.sh                    # SSH 模式，使用默认配置
#   ./scripts/deploy.sh user@host          # SSH 模式，指定服务器
#   ./scripts/deploy.sh --webhook          # Webhook 模式，使用默认配置
#   ./scripts/deploy.sh --webhook http://server:9000 SECRET
# ============================================

# 配置项（请根据实际情况修改）
DEFAULT_SERVER="root@212.129.242.30"       # 默认服务器，格式: user@host
SSH_PORT="22"                               # SSH 端口
REMOTE_DIR="/root/deployment/tyre-flow"         # 服务器上的项目目录
REPO_URL="git@gitee.com:young91/tyre-flow.git"
BRANCH="main"

# Webhook 配置
DEFAULT_WEBHOOK_URL="http://212.129.242.30:9000"
WEBHOOK_ENDPOINT="/hooks/deploy"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}"
    echo "========================================"
    echo "🚀 Tyre Flow 部署工具"
    echo "========================================"
    echo -e "${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${BLUE}📋 $1${NC}"
}

# 显示帮助信息
show_help() {
    echo "使用方法:"
    echo "  ./scripts/deploy.sh [选项] [参数]"
    echo ""
    echo "部署模式:"
    echo "  (默认)              SSH 模式，直接连接服务器执行部署"
    echo "  --webhook, -w       Webhook 模式，通过 HTTP 请求触发部署"
    echo ""
    echo "SSH 模式参数:"
    echo "  ./scripts/deploy.sh              使用默认服务器"
    echo "  ./scripts/deploy.sh user@host    指定服务器"
    echo ""
    echo "Webhook 模式参数:"
    echo "  ./scripts/deploy.sh --webhook                              使用默认配置"
    echo "  ./scripts/deploy.sh --webhook http://server:9000           指定服务器 URL"
    echo "  ./scripts/deploy.sh --webhook http://server:9000 SECRET    指定 URL 和密钥"
    echo ""
    echo "其他选项:"
    echo "  --help, -h          显示帮助信息"
    echo "  --status, -s        查看部署状态（需要 webhook 模式）"
    echo ""
    echo "环境变量:"
    echo "  DEPLOY_SECRET       Webhook 部署密钥"
    echo "  WEBHOOK_URL         Webhook 服务器 URL"
}

# Webhook 模式部署
deploy_webhook() {
    local webhook_url="${1:-$DEFAULT_WEBHOOK_URL}"
    local deploy_secret="${2:-$DEPLOY_SECRET}"
    
    print_header
    echo "📡 部署模式: Webhook"
    echo "🌐 Webhook URL: ${webhook_url}${WEBHOOK_ENDPOINT}"
    echo "📅 时间: $(date)"
echo "========================================"
    echo ""
    
    # 检查密钥
    if [ -z "$deploy_secret" ]; then
        print_error "未提供部署密钥！"
        echo ""
        echo "请通过以下方式之一提供密钥:"
        echo "  1. 设置环境变量: export DEPLOY_SECRET=your-secret"
        echo "  2. 命令行参数: ./scripts/deploy.sh --webhook URL SECRET"
        exit 1
    fi
    
    # 确认部署
    read -p "确认触发部署? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_error "部署已取消"
        exit 1
    fi
    
    echo ""
    print_info "正在触发部署..."

    # 发送 webhook 请求 (token 通过 URL 参数传递)
    response=$(curl -s -w "\n%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -d '{}' \
        "${webhook_url}${WEBHOOK_ENDPOINT}?token=${deploy_secret}" 2>&1)
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    echo ""
    if [ "$http_code" = "200" ]; then
        print_success "部署已触发！"
        echo "服务器响应: $body"
        echo ""
        print_info "部署正在后台执行，可通过以下方式查看进度:"
        echo "  1. SSH 到服务器查看日志: tail -f /var/log/deploy.log"
        echo "  2. 查看 Docker 日志: docker logs -f tyre-flow-webhook"
    else
        print_error "触发部署失败！"
        echo "HTTP 状态码: $http_code"
        echo "响应内容: $body"
        exit 1
    fi
}

# 检查 Webhook 健康状态
check_webhook_health() {
    local webhook_url="${1:-$DEFAULT_WEBHOOK_URL}"
    
    print_info "检查 Webhook 服务状态..."
    
    response=$(curl -s -w "\n%{http_code}" \
        "${webhook_url}/hooks/health" 2>&1)
    
    http_code=$(echo "$response" | tail -n1)
    
    if [ "$http_code" = "200" ]; then
        print_success "Webhook 服务运行正常"
    else
        print_error "Webhook 服务不可用 (HTTP $http_code)"
        exit 1
    fi
}

# SSH 模式部署
deploy_ssh() {
    local server="${1:-$DEFAULT_SERVER}"
    
    print_header
    echo "📡 部署模式: SSH"
    echo "📡 目标服务器: $server"
echo "📂 远程目录: $REMOTE_DIR"
echo "🔀 分支: $BRANCH"
echo "📅 时间: $(date)"
echo "========================================"
echo ""

# 确认部署
    read -p "确认部署到 $server? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_error "部署已取消"
    exit 1
fi

echo ""
    print_info "连接服务器并执行部署..."

# SSH 到服务器执行部署命令
    ssh -p $SSH_PORT $server << ENDSSH
set -e

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

# 启用 BuildKit 以获得更好的缓存和并行构建
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

# 使用缓存构建（只有变更的层会重新构建）
docker compose build

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
    print_success "本地部署脚本执行完毕！"
}

# 主函数
main() {
    case "${1:-}" in
        --help|-h)
            show_help
            ;;
        --webhook|-w)
            shift
            deploy_webhook "$@"
            ;;
        --status|-s)
            shift
            check_webhook_health "$@"
            ;;
        *)
            deploy_ssh "$@"
            ;;
    esac
}

main "$@"
