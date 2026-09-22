# 后台用户详情

详情页默认总览；套餐、图表、管理抽屉分别由独立组件负责。图表使用每日聚合接口，默认 30 天，可选 7/90 天。显示日期统一为 Asia/Shanghai；永久权益显示“永久有效”。

## 权益投影

`GET /api/admin/customers/:id/entitlements?scope=current` 返回全部当前和预约权益，不受历史分页影响。`scope=history&page=1&pageSize=10` 按需读取已取消、已过期权益。不指定 scope 保持原分页接口行为。

新增兼容字段：`displayState`、`group`、`permanent`、`remainingDays`、`nextResetAt`、`orders`、`canAdjustValidity`、`canActivate`；额度桶新增 `canAdjust`。套餐到期取权益 endsAt，不取额度桶 endsAt。普通套餐、Ultra、独立包和奖励分组显示。发现多份当前普通套餐或缺少当前周期额度时显示异常，不自动修复历史数据。

## 提前启用已购套餐

- `GET /api/admin/customers/:id/entitlements/:grantId/activation-preview`：返回原订单、目标、当前套餐损失、预计新有效期和 `expectedState`。
- `POST /api/admin/customers/:id/entitlements/:grantId/activate`：请求 `{expectedState, reason}`，必须携带 `Idempotency-Key`。
- 权益领域的 `ScheduledPlanActivation` 用 Serializable 事务、用户行锁和结构状态校验处理。审计记录承载幂等结果；相同 key 的不同请求被拒绝，并发冲突有限重试。
- 只接受可确认完整月/季/年周期、未使用/未调整的普通套餐预约。拒绝冲突预约、退款、异常兼容周期；不修改支付快照、原订单关联和历史用量。
- 旧普通套餐结束；原目标权益从确认时间获得完整购买周期；其兼容订阅及额度周期同步移动。目标已成团奖励同步移动，数量、权限和倍率不变；之后成团的奖励使用权益实际到期时间。独立流量包和 Ultra 不变。
- 接入权限继续由已有权益/节点同步链路读取新的生效区间，无须重启节点或全量踢线。

## 管理调整

- 额度调整必须提供 `expectedRemainingBytes` 和操作说明，核验路由用户归属及当前有效状态，同步对应兼容订阅周期或流量包，不清空消耗、不延长有效期。用户详情的调整表单不要求手填原因，由页面按操作类型提交自动说明；权限、二次确认、并发校验及审计保持不变。
- 余额调整提供 `expectedBalanceCents`、`note` 和幂等键；倍率调整提供 `expectedMultiplier`、`reason`。过期预览返回冲突。
- 免费赠送是独立操作：先 `GET :id/plan-switch/preview?offerId=...` 查看将结束的当前/预约普通套餐，再 `POST :id/plan-switch` 携带 `{offerId, expectedState, reason}` 和幂等键。该操作仍新增免费订单，不能替代提前启用已购套餐。
- 有效期调整继续复用原接口和并发校验，拒绝普通套餐预约重叠；Ultra 不作为普通套餐冲突项。

提前启用已购套餐仅允许后台管理员操作，不向用户开放入口或接口；预约套餐仍按原定时间自动生效。

## 本地验证

真实 PostgreSQL 用例在 `apps/api/test/customer-memberships.e2e-spec.ts`。数据库限定为 `127.0.0.1/seo_brief_test`，仅建立并清理专属测试实体，禁止指向生产库。覆盖日历边界、幂等并发、退款、权益共存、奖励、额度同步、余额和倍率冲突。

本次无数据库迁移、不自动纠正历史用户、不部署。上线前沿用数据库备份、候选服务健康检查及切换流程。
