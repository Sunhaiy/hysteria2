# Mihomo 节点列表独立更新

完整 Clash 订阅默认使用 HTTP `proxy-providers`：节点列表每 900 秒拉取，完整订阅继续通过 `Profile-Update-Interval: 12` 建议每 12 小时更新。完整订阅实际更新频率由客户端设置决定。

- 已导入用户需先刷新一次完整订阅；仅修改服务器不会改写客户端旧配置。
- 全量节点：`GET /subscribe/:token/clash/nodes?scope=all`。
- AI 节点：同一路径 `scope=ai`，按现有美国节点规则筛选；没有匹配节点时使用全部授权节点。
- 不支持当前 Mihomo provider 功能的客户端可在完整 Clash 订阅链接添加 `mode=inline`（已有查询参数时使用 `&mode=inline`）。普通 URI 订阅保持不变。
- 分流规则、节点连接参数和策略组名称保持不变；provider 成功更新会替换节点集合，不重新加载整份配置。节点被删除或用户手选节点变化时，仍可能需要重新选择，不能保证所有已有连接无中断。
- 初次导入内含 bootstrap 节点。下载失败由内核保留已有缓存；缓存路径按订阅 URL 分隔，不在账户间混用。
- 每次拉取重新检查身份及权益。有效令牌已无访问权限时返回 reject 占位节点；无效/撤销令牌返回错误，后端异常不伪装成空列表。服务端断连与鉴权仍是实际访问控制，不依赖客户端刷新。
- Provider 响应禁止共享缓存，节点来源使用受信的 `API_PUBLIC_URL`，不使用请求 Host。

本地真实内核验证：设置 `MIHOMO_TEST_BINARY` 后在 `apps/api` 执行 `pnpm exec jest --config test/jest-e2e.json mihomo-provider-refresh --runInBand`。测试只访问回环地址，将同一定时器加速到 1 秒，检查离线启动、自动替换、故障缓存和无权限占位，不连接生产节点。

参考：[Mihomo proxy-providers](https://wiki.metacubex.one/config/proxy-providers/)、[策略组](https://wiki.metacubex.one/config/proxy-groups/)。
