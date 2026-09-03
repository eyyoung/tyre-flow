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
这样做是因为服务器上行/跨境带宽很小，推送镜像经常失败，而服务器从 npmmirror 等国内源下载很快；从 GitHub 下载产物夜间约 10 MB/s，白天高峰只有几十 KB/s，白天请用下面的「从本机部署」。

```
GitHub Actions                                 生产服务器 (8.148.203.142)
─────────────────────────────                  ─────────────────────────────────────────
npm ci → prisma generate → next build          provision.sh  幂等初始化（apt 包 / Node / venv / systemd，无需 LibreOffice）
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
3. Actions → Deploy → Run workflow。首次会安装 Node 和 Python 依赖，约 2 分钟；之后每次部署只需 1 分钟左右，停机时间为 web 重启的几秒。

也可以在本地手动执行初始化（幂等，可反复运行）：

```bash
ssh -i ~/.ssh/deploy.pem root@8.148.203.142 'bash -s' < scripts/server/provision.sh
```

### 白天从本机部署

白天服务器从 GitHub 拉产物可能要几十分钟。改为本机中转：本机走代理从 GitHub 下载很快，本机到阿里云是国内链路。

1. Actions → Deploy → Run workflow，`mode` 选 **build-only**：只构建并上传产物（约 2 分钟），不碰服务器。
2. 本机执行（需要 `gh` 已登录、能 ssh 到服务器 root）：

   ```bash
   scripts/deploy-from-local.sh            # 部署 origin/main 最新提交
   scripts/deploy-from-local.sh <git-sha>  # 或指定提交
   ```

   脚本会下载并校验产物、scp 到服务器 `/opt/tyre-flow/tmp/`，然后用被部署提交里的 provision.sh / deploy.sh 完成余下步骤（deploy.sh 发现产物已在本地且校验通过会跳过下载）。`DRY_RUN=1` 只下载上传不部署；`DEPLOY_HOST`、`DEPLOY_SSH_OPTS` 可覆盖服务器地址和 ssh 参数。

注意：本机部署不会重写服务器上的 `shared/.env`（它由 CI 从 Secrets 生成）。改过 Secrets 时走一次 CI 的 full 模式。服务器同一时间只允许一个部署（`/opt/tyre-flow/deploy.lock`），如果 CI 的 Deploy 正卡在下载，先在 GitHub 取消它。

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
- Node 版本在 `scripts/server/provision.sh` 顶部维护。服务器不需要 LibreOffice：ISCC 自我声明直接填充 PDF 表单生成。
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

ISCC 批量导出会创建数据库任务，由独立的 `tyre-flow-worker` 进程分批生成、合并和打包。用户可以关闭页面，之后重新打开导出窗口查看进度或下载；进行中的任务可以在窗口里停止（worker 在两份文档之间检查停止标记，已生成的临时文件会被清理）；完成文件默认保留 7 天。

### ISCC 自我声明模板

自我声明直接填充 `template/` 下带命名字段的 PDF 表单（pdf-lib），不经过 Word 和 LibreOffice：

| 模板 | 文件 | 来源 |
|------|------|------|
| ISCC PLUS v1.2 (2024) | `template/ISCC.pdf` | 由 `template/ISCC.docx` 经 `npm run iscc:build-v1-template` 生成（本机需要 LibreOffice 和 poppler-utils） |
| ISCC PLUS v2.0 (2025) | `template/ISCC_PLUS.pdf` | ISCC 官方可填写表单 |
| ISCC EU v2.3 (2025) | `template/ISCC_EU.pdf` | ISCC 官方可填写表单 |

字段与数据的对应关系在 `src/lib/iscc-pdf-form.ts`。表单内置 Helvetica 字体，只能输出 Latin 字符：中文会自动转为拼音，其余不可编码字符会被丢弃，所以门店、收集点字段应尽量维护好英文翻译。改过模板或映射后用 `npm run iscc:preview` 生成样例（输出在 `data/iscc-exports/preview/`）核对。
