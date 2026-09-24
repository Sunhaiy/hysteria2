# CDK 使用次数

后台创建 CDK 时分别配置「每张码总使用次数」与「每人可使用次数」。
例如总次数 10、每人次数 2，表示所有用户合计最多兑换 10 次，同一个用户最多兑换 2 次。
套餐、流量包、余额与结算折扣码均应用此限制；套餐原有续费/替换规则保持不变。

`POST /api/admin/redemption-codes` 接受可选正整数 `maxUsesPerUser`，省略时为 1。
`PATCH /api/admin/redemption-codes/:id` 可修改该字段；列表返回该字段。
后台列表的「次数限制」用于修改已生成 CDK。

调整限制不清除历史记录，不撤回已经发放的权益，也不恢复已用完或作废的码。
如果一个用户已兑换两次，将上限从两次降低到一次后，该用户无法继续兑换。
总次数独立生效，提高每人次数不会提高总次数。

迁移 `20260924180000_redemption_per_user_limit` 为现有码设置每人一次，
现有兑换记录保留并标记为该用户的第一次。上线前需要备份、验证迁移，再启动新版 API。
余额入账使用码、用户及使用序号组成的幂等键；次数记录与权益发放位于同一事务。

真实 PostgreSQL 回归测试：设置 `CDK_TEST_DATABASE_URL` 指向本机专用
`cdk_limit_test` 数据库，在 API 目录执行
`pnpm exec jest --config test/jest-e2e.json redemption-user-limit --runInBand`。
测试拒绝远程数据库，覆盖个人/总次数、历史限制调整、并发以及失败回滚。
