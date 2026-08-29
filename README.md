# Tyre Flow - 轮胎回收台账追溯系统

轮胎回收台账追溯系统，用于管理轮胎回收的收集点、门店、车辆和台账记录。

## 功能特性

- 🏢 收集点管理
- 🏪 门店管理（支持批量生成虚拟门店）
- 🚗 车辆管理（收集车辆和转移车辆）
- 📋 收集台账管理（按月份生成）
- 🔄 转移台账管理（按吨数手动触发）
- 👤 司机台账查询（按司机维度汇总）
- 📊 仪表盘数据统计
- 🌐 国际化支持（中文/英文）
- 📥 Excel 导出
- 🗂️ ISCC 后台导出（持久化进度，完成后下载 ZIP）

## 技术栈

- **前端**: Next.js 16, React 19, Ant Design 5.x
- **后端**: Next.js API Routes
- **数据库**: PostgreSQL + Prisma ORM
- **认证**: JWT Token
- **国际化**: next-intl

## 快速开始

### 本地开发

0. 启动数据库
```bash
docker-compose up db
```

1. 安装依赖：
```bash
npm install
```

2. 配置环境变量：
```bash
cp .env.example .env
# 编辑 .env 文件，配置数据库连接等
```

3. 初始化数据库：
```bash
npm run db:push
npm run db:seed
```

4. 启动开发服务器：
```bash
npm run dev
```

5. 访问 [http://localhost:3000](http://localhost:3000)

默认管理员账号：
- 用户名: `admin`
- 密码: `admin123`

### Docker 部署

#### 方式一：使用 Docker Compose（推荐）

1. 创建环境变量文件：
```bash
# 创建 .env 文件并配置
cat > .env << EOF
POSTGRES_USER=tyre_flow
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=tyre_flow
JWT_SECRET=your-super-secret-jwt-key
NEXTAUTH_SECRET=your-nextauth-secret
NEXTAUTH_URL=http://localhost:3000
EOF
```

2. 启动服务：
```bash
# 首次部署，需要初始化数据库
docker-compose --profile setup up -d

# 等待数据库初始化完成后，正常启动
docker-compose up -d
```

3. 访问 [http://localhost:3000](http://localhost:3000)

#### 方式二：单独构建

```bash
# 构建镜像
docker build -t tyre-flow .

# 运行容器（需要外部 PostgreSQL）
docker run -d \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:password@host:5432/db" \
  -e JWT_SECRET="your-jwt-secret" \
  tyre-flow
```

### Docker Compose 命令

```bash
# 启动所有服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down

# 停止并删除数据卷
docker-compose down -v

# 重新构建
docker-compose build --no-cache
```

## 项目结构

```
├── prisma/              # Prisma 数据库配置
│   ├── schema.prisma    # 数据库模型定义
│   └── seed.ts          # 初始数据种子
├── src/
│   ├── app/             # Next.js App Router
│   │   ├── api/         # API 路由
│   │   └── [locale]/    # 国际化页面
│   ├── components/      # React 组件
│   ├── lib/             # 工具函数
│   └── i18n/            # 国际化配置
├── docker-compose.yml   # Docker Compose 配置
├── Dockerfile           # 应用 Dockerfile
└── Dockerfile.migrate   # 数据库迁移 Dockerfile
```

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| DATABASE_URL | PostgreSQL 连接字符串 | - |
| JWT_SECRET | JWT 签名密钥 | - |
| NEXTAUTH_SECRET | NextAuth 密钥 | - |
| NEXTAUTH_URL | 应用 URL | http://localhost:3000 |
| POSTGRES_USER | 数据库用户名 | tyre_flow |
| POSTGRES_PASSWORD | 数据库密码 | - |
| POSTGRES_DB | 数据库名称 | tyre_flow |
| ISCC_EXPORT_BATCH_SIZE | ISCC Worker 每批处理的门店数（10-100） | 50 |
| ISCC_WORKER_MEMORY_LIMIT | ISCC Worker 容器内存上限 | 768m |

ISCC 批量导出会创建数据库任务，由独立 `iscc-worker` 容器分批生成、转换和打包。用户可以关闭页面，之后重新打开导出窗口查看进度或下载；完成文件默认保留 7 天。
