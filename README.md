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

0. 准备一个 PostgreSQL（任选其一）
```bash
# 本机已有 PostgreSQL：直接在 .env 里配置 DATABASE_URL
# 或用 Docker 起一个（仅本地开发用，生产不使用 Docker）
docker run -d --name tyre-flow-db -p 5432:5432 \
  -e POSTGRES_USER=tyre_flow -e POSTGRES_PASSWORD=tyre_flow_password -e POSTGRES_DB=tyre_flow \
  postgres:16-alpine
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

## 生产部署

生产环境不使用 Docker，直接以代码构建产物运行：GitHub Actions 负责构建，服务器只负责拉取产物并运行。
这样做是因为服务器上行/跨境带宽很小，推送镜像经常失败，而服务器从 GitHub、npmmirror 等源**下载**很快。

```
GitHub Actions                                 生产服务器 (8.148.203.142)
─────────────────────────────                  ─────────────────────────────────────────
npm ci → prisma generate → next build          provision.sh  幂等初始化（apt 包 / Node / venv / systemd）
打包 standalone 产物 tyre-flow-<sha>.tar.zst   deploy.sh     下载产物 → db push + seed → 切换 current → 重启 → 健康检查
上传到 GitHub Release (tag: deploy-artifacts)                （失败自动回滚到上一个 release）
通过 SSH 发送 .env 和上面两个脚本（几 KB）
```

服务器上的布局与进程：

```
/opt/tyre-flow/
├── repo/                  git checkout（签名服务源码 + 字体）
├── releases/<时间>-<sha>/  每次部署一个目录（server.js、.next、node_modules、template、prisma）
├── current -> releases/…  当前运行版本
├── previous -> releases/… 上一个版本（回滚用）
├── shared/.env            运行时环境变量（由 CI 从 GitHub Secrets 写入）
├── shared/data/iscc-exports/  ISCC 导出文件（持久化）
├── tools/                 prisma CLI（只在版本变化时重装）
└── signature/.venv        签名服务 Python 虚拟环境

systemd 服务（均以 tyreflow 用户运行）:
  tyre-flow-web        node server.js        0.0.0.0:3000
  tyre-flow-worker     同一份产物, ISCC_EXPORT_WORKER=true   127.0.0.1:3001, 内存上限 768M / 1 核
  tyre-flow-signature  python server.py (Flask)               127.0.0.1:3333
```

### 首次部署

1. 在 GitHub 仓库配置 `prod` environment 的 Secrets：`DEPLOY_SSH_PRIVATE_KEY`、`EXTERNAL_DB_URL`、`JWT_SECRET`、`NEXTAUTH_SECRET`，以及可选的 `NEXTAUTH_URL`、`SECURE_COOKIES`、`AMAP_API_KEY`、`LBS_PROVIDER`、`TENCENT_LBS_KEY`、`TENCENT_LBS_SK`、`SIGNATURE_SERVICE_URL`、`ALIBABA_CLOUD_ACCESS_KEY_ID`、`ALIBABA_CLOUD_ACCESS_KEY_SECRET`。
2. 服务器操作系统使用 **Debian 12**（阿里云公共镜像即可），换系统时绑定 `DEPLOY_SSH_PRIVATE_KEY` 对应的密钥对；安全组放行 3000 端口（3001 / 3333 只监听本机，不需要放行）。
3. Actions → Deploy → Run workflow。首次会安装 Node、LibreOffice、字体、Python 依赖，约 5 分钟；之后每次部署只需 1 分钟左右，停机时间为 web 重启的几秒。

也可以在本地手动执行初始化（幂等，可反复运行）：

```bash
ssh -i ~/.ssh/deploy.pem root@8.148.203.142 'bash -s' < scripts/server/provision.sh
```

### 日常运维

```bash
# 查看状态（当前版本、各服务状态、健康检查）
ssh root@HOST 'bash -s -- status' < scripts/server/deploy.sh

# 回滚到上一个 release
ssh root@HOST 'bash -s -- rollback' < scripts/server/deploy.sh

# 重新部署某个已构建的 commit（产物仍在 GitHub Release 里）
ssh root@HOST 'bash -s -- deploy <完整 git sha>' < scripts/server/deploy.sh

# 日志
ssh root@HOST 'journalctl -u tyre-flow-web -f'
ssh root@HOST 'journalctl -u tyre-flow-worker -n 200 --no-pager'

# 连生产库排障（服务器上装了 psql）
ssh root@HOST 'set -a; . /opt/tyre-flow/shared/.env; psql "$DATABASE_URL" -c "select 1"'
```

### 说明与约定

- 数据库结构用 `prisma db push --accept-data-loss` 同步（与之前的 Dockerfile.migrate 一致），随后执行幂等的 seed。生产库没有 `_prisma_migrations` 表，`prisma/migrations` 目前只用于本地开发；要切到 `migrate deploy` 需先做 baseline。
- LibreOffice 7.4.7 与 Liberation、文泉驿正黑/微米黑字体直接来自 Debian 12 的 apt，与原 Docker 镜像（node:20-slim，同为 Debian 12）完全一致，docx → pdf 渲染不变。Node 版本在 `scripts/server/provision.sh` 顶部维护。
- 进程时区固定为 UTC（与原容器一致）。如需改为北京时间，修改 provision.sh 里 unit 的 `TZ` 后重新部署。
- 构建产物公开可下载（仓库本身公开，产物不含任何密钥）。若仓库转为私有，需给 deploy.sh 提供带 token 的 `DEPLOY_ARTIFACT_BASE_URL`。
- 保留最近 5 个 release 与最近 10 次构建产物，可通过 `KEEP_RELEASES` / workflow 里的 `KEEP_ARTIFACTS` 调整。

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
├── handwriting-simulator/  # 手写签名生成服务（Python/Flask）
├── scripts/server/
│   ├── provision.sh     # 服务器幂等初始化
│   └── deploy.sh        # 服务器端部署 / 回滚 / 状态
└── .github/workflows/deploy.yml  # 构建 + 部署流水线
```

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| DATABASE_URL | PostgreSQL 连接字符串 | - |
| JWT_SECRET | JWT 签名密钥 | - |
| NEXTAUTH_SECRET | NextAuth 密钥 | - |
| NEXTAUTH_URL | 应用 URL | http://localhost:3000 |
| SECURE_COOKIES | 是否只在 HTTPS 下发 Cookie | false |
| SIGNATURE_SERVICE_URL | 签名服务地址 | http://127.0.0.1:3333/generate |
| ISCC_EXPORT_DIR | ISCC 导出文件目录 | /opt/tyre-flow/shared/data/iscc-exports |
| ISCC_EXPORT_BATCH_SIZE | ISCC Worker 每批处理的门店数（10-100） | 50 |

ISCC 批量导出会创建数据库任务，由独立的 `tyre-flow-worker` 进程分批生成、转换和打包。用户可以关闭页面，之后重新打开导出窗口查看进度或下载；完成文件默认保留 7 天。
