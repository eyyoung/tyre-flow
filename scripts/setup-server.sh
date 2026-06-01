#!/bin/bash
set -e

# ============================================
# 服务器初始化脚本
# 首次部署前在本地执行，用于初始化服务器环境
#
# 使用方法:
#   ./scripts/setup-server.sh user@host                           # 使用 Docker 数据库（默认）
#   ./scripts/setup-server.sh user@host -d "postgresql://..."     # 使用外部数据库
#   ./scripts/setup-server.sh user@host -p 2222                   # 指定 SSH 端口
# ============================================

show_help() {
    echo "使用方法:"
    echo "  ./scripts/setup-server.sh user@host [选项]"
    echo ""
    echo "选项:"
    echo "  -d, --database-url URL   使用外部数据库（如 RDS）"
    echo "                           示例: -d \"postgresql://user:pass@host:5432/db\""
    echo "  -p, --port PORT          指定 SSH 端口（默认: 22）"
    echo "  -h, --help               显示帮助信息"
    echo ""
    echo "示例:"
    echo "  # 使用 Docker 本地数据库（默认）"
    echo "  ./scripts/setup-server.sh root@192.168.1.100"
    echo ""
    echo "  # 使用外部 RDS 数据库"
    echo "  ./scripts/setup-server.sh root@192.168.1.100 -d \"postgresql://user:pass@rds.example.com:5432/mydb\""
    echo ""
    echo "  # 指定 SSH 端口"
    echo "  ./scripts/setup-server.sh root@192.168.1.100 -p 2222"
}

if [ -z "$1" ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_help
    exit 0
fi

SERVER="$1"
SSH_PORT="22"
DATABASE_URL=""
USE_EXTERNAL_DB=false

# 解析参数
shift  # 跳过第一个参数（服务器地址）
while [[ $# -gt 0 ]]; do
    case "$1" in
        -p|--port)
            SSH_PORT="$2"
            shift 2
            ;;
        -d|--database-url)
            DATABASE_URL="$2"
            USE_EXTERNAL_DB=true
            shift 2
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

REMOTE_DIR="/root/deployment/tyre-flow"
REPO_URL="${REPO_URL:-https://github.com/eyyoung/tyre-flow.git}"

echo "🔧 Tyre Flow 服务器初始化"
echo "========================================"
echo "📡 目标服务器: $SERVER"
if [ "$USE_EXTERNAL_DB" = true ]; then
    # 隐藏密码显示
    MASKED_URL=$(echo "$DATABASE_URL" | sed 's/:[^:@]*@/:****@/')
    echo "🗄️ 数据库模式: 外部数据库"
    echo "   URL: $MASKED_URL"
else
    echo "🗄️ 数据库模式: Docker 本地数据库"
fi
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

# 从 SERVER 变量中提取 IP/主机名 (user@host -> host)
SERVER_HOST=$(echo "$SERVER" | cut -d'@' -f2)

# 检查服务器上是否已有 .env 文件，如果有则读取已有的密钥
echo "🔍 检查服务器上的现有配置..."
EXISTING_ENV=$(ssh -p $SSH_PORT $SERVER "cat $REMOTE_DIR/.env 2>/dev/null || echo ''")

if [ -n "$EXISTING_ENV" ]; then
    echo "✅ 发现已有 .env 文件，读取现有密钥..."
    
    # 从现有配置中提取密钥
    JWT_SECRET=$(echo "$EXISTING_ENV" | grep "^JWT_SECRET=" | cut -d'=' -f2 | tr -d '\r')
    NEXTAUTH_SECRET=$(echo "$EXISTING_ENV" | grep "^NEXTAUTH_SECRET=" | cut -d'=' -f2 | tr -d '\r')
    DB_PASSWORD=$(echo "$EXISTING_ENV" | grep "^POSTGRES_PASSWORD=" | cut -d'=' -f2 | tr -d '\r')
    
    # 如果某些密钥不存在，生成新的
    [ -z "$JWT_SECRET" ] && JWT_SECRET=$(openssl rand -hex 32) && echo "   生成新的 JWT_SECRET"
    [ -z "$NEXTAUTH_SECRET" ] && NEXTAUTH_SECRET=$(openssl rand -hex 32) && echo "   生成新的 NEXTAUTH_SECRET"
    [ -z "$DB_PASSWORD" ] && DB_PASSWORD=$(openssl rand -hex 32) && echo "   生成新的 POSTGRES_PASSWORD"
else
    echo "📝 未发现 .env 文件，生成新密钥..."
    JWT_SECRET=$(openssl rand -hex 32)
    NEXTAUTH_SECRET=$(openssl rand -hex 32)
    DB_PASSWORD=$(openssl rand -hex 32)
fi

# 根据数据库模式生成不同的 .env 内容
if [ "$USE_EXTERNAL_DB" = true ]; then
    # 外部数据库模式
    ENV_CONTENT="# ============================================
# 数据库配置 - 外部数据库模式
# ============================================
EXTERNAL_DB_URL=${DATABASE_URL}

# ============================================
# 应用配置
# ============================================
JWT_SECRET=${JWT_SECRET}
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
NEXTAUTH_URL=http://${SERVER_HOST}:3000

# Cookie 安全设置
# 如果使用 HTTPS，设置为 true
# 如果使用 HTTP，设置为 false
SECURE_COOKIES=false"
else
    # Docker 本地数据库模式
    ENV_CONTENT="# ============================================
# 数据库配置 - Docker 本地数据库模式
# ============================================
POSTGRES_USER=tyre_flow
POSTGRES_PASSWORD=${DB_PASSWORD}
POSTGRES_DB=tyre_flow

# ============================================
# 应用配置
# ============================================
JWT_SECRET=${JWT_SECRET}
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
NEXTAUTH_URL=http://${SERVER_HOST}:3000

# Cookie 安全设置
# 如果使用 HTTPS，设置为 true
# 如果使用 HTTP，设置为 false
SECURE_COOKIES=false"
fi

ssh -p $SSH_PORT $SERVER << ENDSSH
set -e

mkdir -p $REMOTE_DIR
cd $REMOTE_DIR

if [ ! -d ".git" ]; then
    echo "📦 初始化仓库..."
    git init
fi
echo "✅ 更新代码..."
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"
git fetch --prune origin main
git reset --hard FETCH_HEAD

# 创建或更新 .env 文件
echo "📝 创建 .env 文件..."
cat > .env << 'EOF'
${ENV_CONTENT}
EOF
echo "✅ .env 文件已创建"
ENDSSH

echo ""
echo "========================================"
echo "✅ 服务器初始化完成！"
echo ""
echo "📋 后续步骤:"
echo ""
echo "   1. SSH 到服务器检查/编辑环境变量（可选）:"
echo "      ssh $SERVER"
echo "      nano $REMOTE_DIR/.env"
echo ""

if [ "$USE_EXTERNAL_DB" = true ]; then
    echo "   2. 首次部署（外部数据库模式）:"
    echo "      在 GitHub Actions 中手动运行 Deploy workflow"
    echo "      或手动执行:"
    echo "      ssh $SERVER 'cd $REMOTE_DIR && docker compose --profile external-db up -d'"
else
    echo "   2. 首次部署（Docker 数据库模式）:"
    echo "      在 GitHub Actions 中手动运行 Deploy workflow"
    echo "      部署脚本会自动检测首次部署并初始化数据库"
fi

echo ""
echo "   3. GitHub Actions 部署:"
echo "      Actions -> Deploy -> Run workflow -> 选择 dev 或 prod"
echo "========================================"
