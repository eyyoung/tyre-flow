# 轮胎回收台账追溯系统 - 开发计划文档

**项目名称：** Tyre Flow - 轮胎回收台账追溯系统  
**技术栈：** Next.js 14 (App Router) + PostgreSQL + Ant Design  
**创建日期：** 2025-12-06  
**当前版本：** MVP v0.1

---

## 📋 总体规划

### 技术架构

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| 前端框架 | Next.js 14+ (App Router) | SSR/SSG 支持 |
| UI 框架 | Ant Design 5.x + Pro Components | 企业级组件库 |
| CSS 方案 | Tailwind CSS + Ant Design | 混合使用 |
| 数据库 | PostgreSQL | 支持 PostGIS |
| ORM | Prisma | 类型安全 |
| 认证 | NextAuth.js + JWT | 会话管理 |
| 国际化 | next-intl | 中英文支持 |
| 地图服务 | 高德地图 Web API | 地址解析、路径规划 |
| 部署 | Docker / 云服务器 | 容器化部署 |

### 开发阶段总览

| 阶段 | 内容 | 状态 | 预估时间 |
|------|------|------|----------|
| Phase 0 | 项目基础搭建 | ✅ 已完成 | 2-3 天 |
| Phase 1 | 用户认证系统 | ✅ 已完成 | 3-4 天 |
| Phase 2 | 基础数据管理 | ✅ 已完成 | 5-7 天 |
| Phase 3 | 台账生成核心算法 | ⚪ 待开始 | 7-10 天 |
| Phase 4 | 数据导出与报表 | ⚪ 待开始 | 3-4 天 |
| Phase 5 | 地图可视化 | ⚪ 待开始 | 3-4 天 |

---

## 🔧 Phase 0: 项目基础搭建

### 目标
- 初始化 Next.js 14 项目
- 配置 PostgreSQL + Prisma ORM
- 集成 Ant Design
- 配置国际化（中/英文）
- 搭建基础布局

### 目录结构

```
tyre-flow/
├── src/
│   ├── app/
│   │   ├── [locale]/              # 国际化路由
│   │   │   ├── (auth)/            # 认证相关页面
│   │   │   │   └── login/
│   │   │   ├── (dashboard)/       # 后台主体
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── page.tsx       # 仪表盘首页
│   │   │   │   ├── users/         # 用户管理
│   │   │   │   ├── collection-points/  # 收集点管理
│   │   │   │   ├── stores/        # 门店管理
│   │   │   │   ├── vehicles/      # 车辆管理
│   │   │   │   ├── ledgers/       # 台账管理
│   │   │   │   └── settings/      # 系统设置
│   │   │   └── layout.tsx
│   │   └── api/                   # API 路由
│   │       ├── auth/
│   │       ├── users/
│   │       ├── collection-points/
│   │       ├── stores/
│   │       └── vehicles/
│   ├── components/
│   │   ├── layout/                # 布局组件
│   │   ├── ui/                    # 通用 UI 组件
│   │   └── forms/                 # 表单组件
│   ├── lib/
│   │   ├── db/                    # 数据库工具
│   │   ├── auth/                  # 认证工具
│   │   └── utils/                 # 通用工具
│   ├── i18n/                      # 国际化配置
│   │   ├── messages/
│   │   │   ├── zh.json
│   │   │   └── en.json
│   │   └── config.ts
│   └── types/                     # TypeScript 类型定义
├── prisma/
│   └── schema.prisma
├── public/
└── ...
```

### 任务清单

- [x] 创建开发计划文档
- [x] 初始化 Next.js 项目
- [x] 安装核心依赖
- [x] 配置 Prisma + PostgreSQL
- [x] 配置 Ant Design
- [x] 配置 next-intl 国际化
- [x] 创建基础布局组件

---

## 🔐 Phase 1: 用户认证系统

### 目标
- 实现登录功能
- JWT Token 认证
- 用户管理 CRUD
- 密码重置功能

### 数据模型

```prisma
model User {
  id            String   @id @default(cuid())
  username      String   @unique
  password      String   // bcrypt 加密
  email         String?  @unique
  name          String?
  role          Role     @default(ADMIN)
  status        Status   @default(ACTIVE)
  lastLoginAt   DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  
  // 收集点绑定关系（Phase 2+）
  collectionPoints UserCollectionPoint[]
}

enum Role {
  ADMIN      // 超级管理员
  USER       // 收集点审核员
}

enum Status {
  ACTIVE
  DISABLED
}
```

### 任务清单

- [x] 设计登录页面 UI
- [x] 实现 JWT 认证配置
- [x] 创建登录 API
- [x] 实现 JWT Token 生成/验证
- [x] 创建用户管理页面
- [x] 实现用户 CRUD API
- [x] 实现密码加密/重置
- [x] 添加登录状态持久化
- [ ] 添加路由守卫（待 Phase 3）

---

## 📦 Phase 2: 基础数据管理

### 目标
- 收集点管理
- 门店管理（虚拟生成）
- 车辆管理
- 参数配置

### 数据模型

```prisma
// 收集点
model CollectionPoint {
  id          String   @id @default(cuid())
  code        String   @unique  // 收集点编码
  name        String
  address     String
  province    String?
  city        String?
  district    String?
  longitude   Float?
  latitude    Float?
  certScope   String?  // 认证范围
  contactName String?
  contactPhone String?
  status      Status   @default(ACTIVE)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  stores      Store[]
  vehicles    Vehicle[]
  users       UserCollectionPoint[]
}

// 用户-收集点关联表
model UserCollectionPoint {
  id                String   @id @default(cuid())
  userId            String
  collectionPointId String
  user              User     @relation(fields: [userId], references: [id])
  collectionPoint   CollectionPoint @relation(fields: [collectionPointId], references: [id])
  createdAt         DateTime @default(now())
  
  @@unique([userId, collectionPointId])
}

// 门店
model Store {
  id                String   @id @default(cuid())
  code              String   @unique  // 门店编码
  name              String
  businessLicense   String?  // 营业执照号（统一社会信用代码）
  legalPerson       String?  // 法人代表
  address           String
  province          String?
  city              String?
  district          String?
  longitude         Float?
  latitude          Float?
  contactName       String?
  contactPhone      String?
  status            StoreStatus @default(ACTIVE)
  disabledAt        DateTime?
  disabledReason    String?
  isVirtual         Boolean  @default(true)  // 是否虚拟生成
  collectionPointId String
  collectionPoint   CollectionPoint @relation(fields: [collectionPointId], references: [id])
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

enum StoreStatus {
  ACTIVE     // 正常
  DISABLED   // 停用（注销/吊销/停业）
}

// 车辆
model Vehicle {
  id                String   @id @default(cuid())
  plateNumber       String   @unique  // 车牌号
  type              VehicleType
  brand             String?  // 品牌
  model             String?  // 型号
  tareWeight        Float    // 皮重（吨）
  tareWeightVariance Float   @default(0.05)  // 皮重随机微调范围
  maxLoad           Float    // 最大载重（吨）
  driverName        String?
  driverPhone       String?
  collectionPointId String
  collectionPoint   CollectionPoint @relation(fields: [collectionPointId], references: [id])
  status            Status   @default(ACTIVE)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

enum VehicleType {
  COLLECTION  // 收集车辆 4.2米
  TRANSFER    // 转移车辆 13米半挂
}

// 系统配置
model SystemConfig {
  id          String   @id @default(cuid())
  key         String   @unique
  value       String
  description String?
  updatedAt   DateTime @updatedAt
}
```

### 配置参数

| 参数名 | 说明 | 默认值 |
|--------|------|--------|
| store_count_min | 每收集点最小门店数 | 1000 |
| store_count_max | 每收集点最大门店数 | 4000 |
| collection_vehicle_count | 收集车辆数量 | 10 |
| transfer_vehicle_count | 转移车辆数量 | 5 |
| collection_vehicle_load | 收集车载重(吨) | 2.0 |
| transfer_vehicle_load | 转移车载重(吨) | 30.0 |
| tire_weight_kg | 单条轮胎重量(kg) | 10 |
| collection_tire_limit | 单次收集条数上限 | 200 |

### 任务清单

- [x] 创建收集点管理页面
- [x] 实现收集点 CRUD API
- [x] 创建门店管理页面
- [x] 实现门店 CRUD API
- [x] 实现虚拟门店批量生成算法
- [x] 创建车辆管理页面
- [x] 实现车辆 CRUD API
- [x] 创建系统配置页面
- [x] 实现配置参数 API

---

## 🧮 Phase 3: 台账生成核心算法（待实现）

### 数据模型

```prisma
// 台账生成任务
model LedgerTask {
  id                String     @id @default(cuid())
  taskNo            String     @unique  // 任务编号
  year              Int
  month             Int
  targetTonnage     Float      // 目标吨数
  actualTonnage     Float?     // 实际吨数
  status            TaskStatus @default(PENDING)
  errorMessage      String?
  startedAt         DateTime?
  completedAt       DateTime?
  collectionPointId String
  collectionPoint   CollectionPoint @relation(fields: [collectionPointId], references: [id])
  collectionRecords CollectionRecord[]
  transferRecords   TransferRecord[]
  createdAt         DateTime   @default(now())
  updatedAt         DateTime   @updatedAt
}

enum TaskStatus {
  PENDING     // 待处理
  PROCESSING  // 处理中
  COMPLETED   // 已完成
  FAILED      // 失败
}

// 收集记录（门店→收集点）
model CollectionRecord {
  id              String   @id @default(cuid())
  recordNo        String   @unique  // 记录编号
  taskId          String
  task            LedgerTask @relation(fields: [taskId], references: [id])
  storeId         String
  store           Store    @relation(fields: [storeId], references: [id])
  vehicleId       String
  vehicle         Vehicle  @relation(fields: [vehicleId], references: [id])
  collectionDate  DateTime
  tireCount       Int      // 轮胎条数
  weight          Float    // 重量（吨）
  remarks         String?
  createdAt       DateTime @default(now())
}

// 转移记录（收集点→工厂）
model TransferRecord {
  id              String   @id @default(cuid())
  recordNo        String   @unique  // 记录编号
  taskId          String
  task            LedgerTask @relation(fields: [taskId], references: [id])
  vehicleId       String
  vehicle         Vehicle  @relation(fields: [vehicleId], references: [id])
  transferDate    DateTime
  destination     String   // 目的地（工厂）
  tireCount       Int      // 轮胎条数
  grossWeight     Float    // 毛重
  tareWeight      Float    // 皮重
  netWeight       Float    // 净重
  weighbridgeNo   String?  // 磅单号
  remarks         String?
  createdAt       DateTime @default(now())
}
```

### 核心算法

1. **总量拆解算法**
   - 输入：月度目标吨数、门店列表、车辆列表
   - 输出：每日收集计划

2. **随机扰动因子**
   - 门店收集频率随机
   - 单次收集数量随机（在限制范围内）
   - 车辆皮重微调

3. **约束条件**
   - 单次收集不超过条数限制
   - 日收集量符合车辆载重
   - 总量平衡

---

## 📊 Phase 4: 数据导出与报表（待实现）

### 导出功能

- Excel 导出
  - 收集台账明细
  - 转移台账明细
  - 门店信息汇总
- PDF 导出
  - 来源点信息表
  - 自我声明
  - 回收合同
  - 过磅单

### 多语言支持

关键字段支持中英文双语导出

---

## 🗺️ Phase 5: 地图可视化（待实现）

### 功能

- 高德地图集成
- 收集点分布图
- 门店分布图（聚合显示）
- 物流路线模拟

---

## 🌍 国际化配置

### 支持语言

- 简体中文 (zh-CN) - 默认
- English (en)

### 切换方式

- URL 路径：`/zh/dashboard`, `/en/dashboard`
- 用户偏好设置
- 浏览器语言检测

---

## 📝 开发日志

### 2025-12-06
- 创建开发计划文档
- ✅ 完成 Phase 0：项目基础搭建
  - 初始化 Next.js 14 项目
  - 配置 PostgreSQL + Prisma ORM
  - 集成 Ant Design + Pro Components
  - 配置 next-intl 国际化（中/英文）
  - 创建基础布局（侧边栏、顶栏）
- ✅ 完成 Phase 1：用户认证系统
  - 实现登录页面（现代化 UI）
  - JWT Token 认证
  - 用户管理 CRUD
- ✅ 完成 Phase 2：基础数据管理
  - 收集点管理模块
  - 门店管理模块
  - 虚拟门店批量生成功能（支持 1000-4000 家）
  - 车辆管理模块（收集车/转移车）
  - 系统配置面板

---

## 🚀 启动指南

### 环境要求

- Node.js 18+
- PostgreSQL 14+
- npm 或 pnpm

### 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
# 编辑 .env 文件，填入数据库连接信息
# DATABASE_URL="postgresql://user:password@localhost:5432/tyre_flow"

# 3. 生成 Prisma Client
npm run db:generate

# 4. 创建数据库并应用迁移
npm run db:push

# 5. 初始化种子数据（创建管理员账户）
npm run db:seed

# 6. 启动开发服务器
npm run dev
```

### 默认账户

- **用户名：** admin
- **密码：** admin123

### 可用脚本

```bash
npm run dev          # 启动开发服务器
npm run build        # 构建生产版本
npm run start        # 启动生产服务器
npm run lint         # 运行 ESLint
npm run db:generate  # 生成 Prisma Client
npm run db:migrate   # 运行数据库迁移
npm run db:push      # 推送 schema 到数据库
npm run db:seed      # 运行种子数据
npm run db:studio    # 打开 Prisma Studio
npm run db:reset     # 重置数据库
```

### 环境变量

```env
# 数据库
DATABASE_URL="postgresql://user:password@localhost:5432/tyre_flow"

# 认证
AUTH_SECRET="your-secret-key-here-min-32-chars-long-xxxxx"
AUTH_URL="http://localhost:3000"

# 应用
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# 高德地图（Phase 5）
NEXT_PUBLIC_AMAP_KEY="your-amap-key"

# 企信宝 API
QIXIN_API_KEY="your-qixin-api-key"
```

