# Agent 统一更新

主站管理员上传 Linux ELF 可执行文件（amd64 / arm64，最大 64 MiB）。主站计算
SHA-256，以持久化 Ed25519 私钥签名固定清单。私钥通过 SETTINGS_ENCRYPTION_KEY
加密保存；更新器只接受首次安装时固定的公钥，不从下载响应更换信任根。

安装包直接保存在 AgentRelease 的二进制字段，列表查询不读取该字段。这样版本、
签名和安装包随现有 PostgreSQL 全量备份一起恢复，没有遗漏安装包目录的问题。
每个架构、版本号不可覆盖；不要无限保留不需要的测试包。

## 首次安装（每个 Agent 一次）

1. 编译更新器：`GOOS=linux GOARCH=amd64 go build -o agent-updater-linux .`
   arm64 机器使用 `GOARCH=arm64`。
2. 后台“Agent 更新”登记服务器、架构和实际 Agent systemd 服务名，下载一次性
   enrollment.json。它含私密更新凭据，只传给对应服务器，不放入 Git 或日志。
3. 将更新器、install.py 和配置通过现有可信 SSH 通道传入服务器，执行：
   `sudo python3 install.py enrollment.json ./agent-updater-linux`
4. 安装器仅增加 Agent 启动覆盖配置和独立更新器服务，不重启 Agent、Xray 或
   Hysteria。确认后台出现心跳后，方可选择该节点发布。

首版安装器要求现有 Agent 以 root 运行且没有额外命令行参数；不符合时明确拒绝，
不会擅自改变服务用户。上传的是 Agent 二进制，不是更新器或 Xray 核心。

## 接口与测试

管理接口统一前缀 `/api/admin/agent-updates`，需要登录管理员及
`AGENT_UPDATES_MANAGE` 权限：

- `GET /`：版本、安装登记、最近 30 批进度和可登记服务器。
- `POST /releases`：multipart `file`、`version`、`architecture`。
- `POST /installations`：`serverId`、`serviceUnit`、`architecture`，仅本次返回凭据。
- `POST /rollouts`：`releaseId`、有序 `installationIds`、`idempotencyKey`。
- `POST /rollouts/:id/cancel`：停止尚未执行的任务。

更新器使用独立 Bearer 凭据访问 `/api/agent-updater`：`POST /poll` 上报
`architecture/currentVersion/currentSha256` 并领取或恢复原任务；
`GET /jobs/:id/artifact` 下载；`POST /jobs/:id/report` 上报
`status/message/currentVersion/currentSha256`。浏览器会话不能替代更新器凭据。

API 集成测试在本地数据库创建隔离 schema，不修改应用表：
`AGENT_UPDATES_DATABASE_TEST=1 pnpm --filter @hysteria/api exec jest agent-updates --runInBand`。
Linux 下运行更新器测试：`go test -v ./...`。跨平台构建使用 `CGO_ENABLED=0`。

## 发布

选择版本和同架构在线节点，确认发布。列表第一台是验证节点，成功后逐台推进。
全站同时最多一个更新任务进入执行阶段。失败或回滚会暂停该批次，取消尚未执行
的节点；解决失败原因后重新选择需要更新的节点发布。管理员停止批次只取消未执行
任务，已执行任务仍完成健康检查或回滚。

更新器仅重启安装时固定的 Agent 单元。新版必须兼容现有环境变量、HTTP 协议及
流量批次文件 v1，不能改变 XRAY_AGENT_STATE_FILE 或重启代理核心。文件校验、
运行中 /proc/PID/exe 校验和、健康接口一起确认版本实际生效。

本地 job.json 在每次替换前 fsync，并以 rename 原子保存；符号链接原子替换，
旧版二进制不删除。重启时优先恢复本地任务；一旦进入替换阶段，即使无法连主站，
也会先完成健康检查或回滚，再重试结果上报。主站不会把心跳暂时中断视为更新失败，
不会在情况不明时给同一节点发布第二个任务。

校验失败不运行安装包；下载网络中断保留任务并重新下载。不会读取、重置、恢复
或删除流量批次文件，避免用旧快照覆盖已确认流量。正常流量采集由原 Agent 的
持久批次协议保证重试幂等。

## 恢复与限制

如果服务器彻底离线，任务保留，整批不继续。恢复服务器上的独立更新器即可继续。
如果回滚也失败，更新器保留 ROLLING_BACK 本地状态并持续恢复，联网时上报恢复
阶段和失败原因；断网时后台显示最后确认阶段与连接时间。不要强制重新登记或清空目录。

首次签名公钥经可信 SSH 配置固定。更换主站加密密钥时必须按既有密钥迁移流程处理；
签名根轮换需要维护窗口重新分发公钥，不能直接删除 signingKey 设置。

功能部署本身不会自动安装更新器或下发版本。2026-09-15 经管理员授权，六台
在用节点已完成首次安装及顺序发布，见 VALIDATION.md。更新器自身与 Xray/Hysteria
核心升级不属于该入口。
