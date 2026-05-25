# Contributing

## 开发环境

1. 安装 `pnpm`
2. 准备 PostgreSQL 和 Redis
3. 复制环境变量文件
4. 执行 Prisma migration 和 seed
5. 运行 `pnpm dev`

参考主仓库 README 中的快速开始步骤。

## 提交前检查

请至少运行这些命令：

```bash
pnpm --filter @hysteria/web lint
pnpm --filter @hysteria/web typecheck
pnpm --filter @hysteria/api test
```

如果你改了 Prisma schema，再补：

```bash
pnpm --filter @hysteria/api prisma:migrate --name your-change
```

## 提交约定

- 保持提交聚焦，一个提交只解决一类问题
- 不要提交 `.env`、数据库目录、构建产物和本地临时文件
- 新增接口时同步更新 README 或相关文档
- 涉及会员、鉴权、流量结算的改动，优先补测试

## PR 建议

- 说明改动目的和影响范围
- 给出验证方式
- 如果有界面改动，附截图或录屏
- 如果有数据结构调整，说明 migration 影响
