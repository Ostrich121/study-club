# 大学生研习社积分统计与排行网站

一个可本地直接运行的 MVP 项目，面向大学生研习社的日常积分管理、成员查询、排行榜展示与报名表维护。

项目已包含：

- 完整前后端代码
- `package.json`
- `Prisma + SQLite / PostgreSQL` 双环境数据库方案
- 示例种子数据
- 默认管理员账号
- 前后台页面
- Excel 导入预览、积分日志、排行榜导出、报名表导出
- Render 部署配置

## 技术栈

- 后端：`Node.js + Express`
- 数据库：
  本地默认 `SQLite`
  线上部署使用 `PostgreSQL`
- ORM：`Prisma`
- Excel 处理：`xlsx`
- 前端：原生 `HTML + CSS + JavaScript`

## 功能说明

### 前台匿名可访问

- `index.html`：身份选择首页
- 成员积分查询
- 成员积分明细查看
- 排行榜导出 Excel
- 报名表页
- 公开报名表导出 Excel

### 管理员登录后可访问

- 管理后台首页
- 成员管理
- 上传成员基础名单
- Excel 上传加分
- 粘贴名单加分
- 手动加减分
- 积分日志查看
- 候选名单管理
- 完整报名表导出

## 页面路径

- `/index.html`：排行榜首页
- 首页先选择身份：
  学员输入姓名进入查询模块
  管理员输入管理密码进入后台
- `/login.html`：管理员登录页
- `/pages/signup.html`：报名表页
- `/admin/dashboard.html`：管理后台首页
- `/admin/members.html`：成员管理页
- `/admin/excel-score.html`：Excel 上传加分页
- `/admin/paste-score.html`：粘贴名单加分页
- `/admin/manual-score.html`：手动加减分页
- `/admin/logs.html`：积分日志页
- `/admin/candidates.html`：候选名单管理页

## 默认管理员账号

- 用户名：`admin`
- 密码：`2025yxs`

当前首页与登录页都支持“仅输入管理密码”进入后台，适配单管理员模式。

## 本地运行步骤

### 1. 安装 Node.js

建议直接使用 `Node.js 20+`。

项目根目录已提供 [.nvmrc](/Users/xu/Desktop/研习社/.nvmrc)，如果你使用 `nvm`，可以直接：

```bash
nvm use
```

### 2. 安装依赖

```bash
npm install
```

### 3. 初始化本地数据库

本地开发默认使用 SQLite，不需要你先安装 PostgreSQL。

```bash
npm run db:init
```

这一步会自动执行：

```bash
npm run prisma:generate
npm run db:push
npm run db:seed
```

### 5. 启动项目

```bash
npm run dev
```

启动后访问：

- 前台首页：`http://localhost:3000/index.html`
- 登录页：`http://localhost:3000/login.html`
- 报名表：`http://localhost:3000/pages/signup.html`

## 数据库说明

### 本地开发

本地默认使用 SQLite，配置在项目根目录的 [.env](/Users/xu/Desktop/研习社/.env)：

```env
DATABASE_URL="file:./dev.db"
PORT=3000
SESSION_SECRET="study-club-local-secret"
NODE_ENV="development"
```

执行 `npm run db:init` 后，Prisma 会在 `prisma/dev.db` 创建本地数据库文件。

### 线上部署

线上部署使用 PostgreSQL。

项目中已额外提供部署专用 Prisma schema：

- 本地默认 schema：[prisma/schema.prisma](/Users/xu/Desktop/研习社/prisma/schema.prisma)
- 部署专用 schema：[prisma/schema.postgresql.prisma](/Users/xu/Desktop/研习社/prisma/schema.postgresql.prisma)

部署时使用：

- `npm run prisma:generate:deploy`
- `npm run db:push:deploy`
- `npm run build:deploy`

## 种子数据说明

`prisma/seed.js` 已内置：

- 默认管理员
- 根据你提供的 `2025年研习社学员名单.xlsx` 导入的 70 名学员
- 3 条示例报名记录
- 默认系统设置

种子脚本已改为“非破坏式初始化”：

- 首次初始化时会创建默认管理员 `admin / 2025yxs`
- 首次初始化时会导入成员基础名单
- 后续再次执行 `npm run db:seed` 不会重置已有积分和日志数据

说明：

- 由于你提供的 Excel 只有“姓名”一列，种子数据会为这 70 名学员自动生成占位学号，格式为 `2025YXS001` 到 `2025YXS070`
- 默认初始积分为 `0`

## Excel 与积分逻辑

### 1. 成员名单导入

支持上传成员基础名单，至少识别：

- 姓名
- 学号

导入前会先预览：

- 待新增成员
- 待更新学号
- 上传名单中的重复姓名
- 无效行
- 学号冲突

### 2. Excel 加分

支持：

- `.xlsx`
- `.xls`

流程：

1. 上传签到 Excel
2. 自动识别姓名列
3. 与成员库按姓名匹配
4. 预览匹配结果
5. 管理员确认后入库

预览结果包括：

- 成功匹配人数
- 未匹配姓名列表
- 重复姓名列表
- 每个人新增积分

### 3. 粘贴名单加分

支持以下分隔方式：

- 换行
- 空格
- 逗号
- 中文逗号
- 顿号
- 分号

同样采用“先预览、再确认”的处理方式。

### 4. 重复提交防护

Excel 加分、粘贴名单加分、手动加减分、成员批量导入都使用了“一次性预览 token + 确认入库”机制：

- 预览生成后得到一次性 token
- 确认入库时消费该 token
- 已确认的 token 不能重复提交

## 排行规则

- 积分高的在前
- 积分相同按姓名拼音排序

## 导出功能

已支持：

- 排行榜导出为 Excel
- 公开报名表导出为 Excel
- 管理员完整报名表导出为 Excel

导出表头均为中文。

## 目录结构

```text
.
├── index.html
├── package.json
├── prisma
│   ├── schema.prisma
│   └── seed.js
├── public
│   ├── login.html
│   ├── admin
│   ├── pages
│   ├── css
│   ├── js
│   └── assets
├── src
│   ├── server.js
│   ├── lib
│   ├── middleware
│   ├── routes
│   ├── services
│   └── utils
└── README.md
```

## 线上部署

当前项目已经改成“本地 SQLite + 线上 PostgreSQL”的双环境版本，优先推荐 `Render + PostgreSQL`。

### 1. 推送代码到 GitHub

把整个项目上传到你的 GitHub 仓库。

注意：

- 不要把 [.env](/Users/xu/Desktop/研习社/.env) 提交到公开仓库
- 仓库中保留 [.env.example](/Users/xu/Desktop/研习社/.env.example) 即可

### 2. 使用 Render 一键部署

项目根目录已提供 [render.yaml](/Users/xu/Desktop/研习社/render.yaml)。

你可以在 Render 中选择：

1. 新建 `Blueprint`
2. 连接 GitHub 仓库
3. 选择当前项目仓库
4. Render 会自动读取 `render.yaml`

它会自动创建：

- 一个 `Node Web Service`
- 一个 `PostgreSQL` 数据库
- 生产环境下的 `DATABASE_URL`
- 自动生成的 `SESSION_SECRET`

### 3. Render 部署时使用的命令

构建命令：

```bash
npm install && npm run build:deploy
```

启动命令：

```bash
npm start
```

健康检查地址：

```text
/api/health
```

### 4. 首次上线后会发生什么

首次部署构建时会自动执行部署专用脚本：

- `prisma generate --schema prisma/schema.postgresql.prisma`
- `prisma db push --schema prisma/schema.postgresql.prisma`
- `prisma seed`

因此会自动完成：

- 建表
- 创建默认管理员
- 导入你提供的 70 名学员基础名单
- 初始化系统设置和示例报名记录

默认管理员仍然是：

- 用户名：`admin`
- 密码：`2025yxs`

### 5. 如果不用 Render

同样也可以部署到 Railway、云服务器或其他支持 `Node.js + PostgreSQL` 的平台。

核心要求只有这几个：

- 设置 `DATABASE_URL`
- 设置 `SESSION_SECRET`
- 设置 `NODE_ENV=production`
- 构建前执行 `npm install`
- 首次部署时执行 `npm run build:deploy`
- 启动时执行 `npm start`

## 后续扩展建议

当前代码结构已为后续扩展预留空间，比较适合继续追加：

- 不同活动不同加分值
- 批量扣分
- 手动积分调整
- 多管理员与角色权限
- 成员状态管理
- 活动表与积分规则表
- 积分区间统计与图表分析

## 说明

由于当前对话运行环境里没有安装 `node / npm`，我没法在这里直接完成 `npm install`、数据库初始化和启动验证；但项目已经补齐为“可本地运行 + 可线上部署”的版本，你按上面的步骤即可继续操作。
