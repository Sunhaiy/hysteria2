# 活动展示与邮件

后台 `/admin/holiday` 提供活动背景、Clash 到期提示和活动邮件。

## 背景图片

上传 PNG/JPEG/WebP（最多 10 MB），复用公告图片的服务端转码与持久化目录。
上传后需要保存活动配置；移除仅解除背景引用，不删除共享图片。背景配置只接受站内
`/api/announcement-images/<uuid>`，不拉取外部 URL。原有备份包含该目录。

## 到期提示

`subscription.expiredNotices` 默认关闭，管理员可配置 1–10 个不重复的名称。
显示统一前缀 `[到期提示]`，目标为保留域名 `subscription-expired.invalid:1`，不可连接。
仅有效、未撤销订阅凭据且账号正常、有已到期套餐、没有当前有效权益时返回。
流量耗尽、节点故障、账号停用和仍有有效流量包/永久权益不会被当作到期。
未来预约不提供当前接入权限。续费后客户端刷新订阅恢复正常节点。
普通 URI 订阅不变；Clash 完整配置与节点 provider 均支持提示。

## 活动邮件

管理员选择指定已注册邮箱、到期用户或全部正常用户。预览冻结文案与收件人，
排除停用、删除和退订用户。指定邮箱最多 500 个，单任务最多 5000 位；
页面展示实际人数和前 20 位。预览一小时有效；必须由创建预览的管理员确认发送。

任务与每人投递记录持久化，预览、确认和取消均有审计。后台 worker 每 10 秒领取
至多 5 封，先原子领取再单独发送；重复确认和并发 worker 不重复发送同一投递。
发送前再次检查账号、邮箱与退订状态。SMTP 未配置不会假报发送成功。
SMTP 失败或进程中断的结果标为待核实，不自动重发，以免重复打扰。
“邮件服务已接受”不是最终投递回执；应结合发件服务的投递日志核实。
取消仅停止尚未领取的邮件，不撤回发送中或已发送的邮件。

正文以纯文本编辑并转义为 HTML，自动附加活动链接和签名退订链接，支持
List-Unsubscribe 一键退订。普通打开退订链接先显示确认页，避免邮件扫描器误退订。
退订只影响活动邮件，不影响验证码和服务通知。JWT_SECRET 轮换会使旧退订签名失效。
部署不创建任务、不发送邮件，也不自动开启活动或到期提示。

新增三张表为纯新增迁移，历史订单、套餐、余额、流量不重写。发布使用候选 API/Web，
验证迁移恢复副本及正常订阅一致后切换；不重启任何节点核心或 Agent。

## 接口

除退订外均要求管理员登录；写请求沿用 Cookie 会话 CSRF 校验。

| 方法 / 路径 | 输入与行为 |
| --- | --- |
| GET /api/admin/settings/subscription-notices | 读取 `{enabled,names}` |
| POST /api/admin/settings/subscription-notices | 保存 `{enabled:boolean,names:string[]}`，写审计 |
| GET /api/admin/campaign-mail | 最近 20 个任务与分类计数 |
| POST /api/admin/campaign-mail/preview | `{subject,body,audience:"all"\|"expired"\|"selected",emails?:string}`；必需 `Idempotency-Key`，同键不同输入拒绝 |
| GET /api/admin/campaign-mail/:id | 文案、实际收件人数、前 20 个邮箱、最多 30 个异常详情 |
| POST /api/admin/campaign-mail/:id/send | `{confirmed:true}`，仅预览创建者可确认，重复请求不重复入队 |
| POST /api/admin/campaign-mail/:id/cancel | 停止未领取邮件，写审计 |
| GET /api/campaign-mail/unsubscribe/:userId/:signature | 公开签名链接，展示退订确认表单 |
| POST /api/campaign-mail/unsubscribe/:userId/:signature | 公开签名链接，幂等退订，无需登录 |

任务状态为 DRAFT、QUEUED、COMPLETED、CANCELED；投递状态为 PENDING、SENDING、
SENT、UNKNOWN、SKIPPED。COMPLETED 表示处理结束，不表示所有邮件成功进入收件箱。
