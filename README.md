# Hysteria 2 Control Plane

Hysteria 2 多用户会员管理系统单仓项目，包含管理后台、用户中心、Hysteria HTTP 鉴权和流量同步能力。

## 组成

- `apps/web`：Next.js 管理台和用户中心
- `apps/api`：NestJS 控制面 API、Hysteria HTTP 鉴权、用量同步
- `packages/ui`：高密度工具风主题 token、基础样式和 UI preset
- `ops/hysteria`：按套餐分层的 Hysteria 节点配置样例

## 当前能力

- 管理台真实 CRUD：用户、节点组、节点、套餐、套餐绑定、订阅、人工订单
- 用户中心真实读取：套餐状态、剩余流量、接入信息、订单记录
- Hysteria 鉴权接口：`POST /integrations/hysteria/auth`
- 后端统一生成 token、URI、二维码和推荐 YAML 片段

## 本地开发

### 1. 安装依赖

```bash
pnpm install
```

### 2. 准备环境变量

```bash
copy .env.example .env
copy apps\web\.env.example apps\web\.env.local
```

如果你使用自定义 PostgreSQL / Redis，请把根目录 `.env` 和 `apps/api/.env` 中的连接串改成你的实例地址。

### 3. 启动基础设施

推荐直接使用 Docker：

```bash
docker compose up -d
```

### 4. 初始化数据库

```bash
pnpm --filter @hysteria/api prisma:migrate --name init
pnpm --filter @hysteria/api prisma:seed
```

### 5. 启动服务

```bash
pnpm dev
```

默认地址：

- Web：`http://127.0.0.1:3001/login`
- API：`http://127.0.0.1:4000`
- 健康检查：`http://127.0.0.1:4000/api/health`

## 本地 seed 账号

这些账号只用于本地开发和演示，生产环境请在初始化后立刻替换：

- 管理员：`ops@hysteria.local / admin123!`
- 会员：`lin@example.com / member123!`

## 常用命令

```bash
pnpm --filter @hysteria/api test
pnpm --filter @hysteria/api test:e2e
pnpm --filter @hysteria/api build
pnpm --filter @hysteria/web build
pnpm --filter @hysteria/api prisma:migrate --name init
pnpm --filter @hysteria/api prisma:seed
```

## 已验证链路

- 管理员登录
- 新建用户并自动签发主访问令牌
- 新建节点组、节点、套餐和套餐绑定
- 新建订阅并自动展开套餐快照
- 新建人工订单并叠加流量包
- 会员登录并查看接入信息、订单和剩余流量
- 新建会员令牌通过 Hysteria 鉴权接口放行

## Hysteria 接入说明

- URI 只包含连接必需字段
- 带宽建议和本地代理端口只放在配置片段里
- 节点权限由套餐绑定的 `node_group` 决定

## 目录结构

```text
apps/
  api/        NestJS + Prisma 控制面
  web/        Next.js 管理台 / 用户中心
packages/
  ui/         主题 token、基础样式、UI preset
ops/
  hysteria/   Hysteria 节点配置样例
```
