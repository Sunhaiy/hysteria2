# Xray VLESS + REALITY 节点代理

这个小型代理把 Xray 的 gRPC `HandlerService` / `StatsService` 转换成控制面现有的 HTTP 节点协议：

- `PUT /users`：把有效订阅用户同步到指定 VLESS inbound
- `GET /traffic`：读取（可清零）用户上下行流量
- `GET /online`：读取用户在线 IP 数
- `POST /kick`：从 inbound 撤销指定用户
- `GET /health`：检查 Xray API 状态

## 1. 配置 Xray

以 [`../xray/vless-reality-server.json`](../xray/vless-reality-server.json) 为起点。至少需要：

- `api.services` 包含 `HandlerService` 和 `StatsService`
- `policy.levels.0` 开启 `statsUserUplink`、`statsUserDownlink`、`statsUserOnline`
- 存在空的 `stats` 对象
- VLESS inbound 的 tag 与 `XRAY_INBOUND_TAG` 一致
- inbound 的 `users` 由控制面独占管理，初始使用空数组

用 `xray x25519` 生成 REALITY 密钥。服务端配置使用私钥；管理后台的“REALITY 公钥 / Password”填写命令输出的 `Password (PublicKey)`。

## 2. 构建和启动代理

代理依赖 Go 1.26：

```bash
cd ops/xray-agent
go mod tidy
go build -trimpath -o hysteria2-xray-agent .
sudo install -m 0755 hysteria2-xray-agent /usr/local/bin/
sudo install -m 0644 hysteria2-xray-agent.service /etc/systemd/system/
sudo install -m 0600 xray-agent.env.example /etc/hysteria2-xray-agent.env
sudo systemctl daemon-reload
sudo systemctl enable --now hysteria2-xray-agent
```

先修改 `/etc/hysteria2-xray-agent.env`，尤其是随机的长密钥。测试：

```bash
curl -H 'Authorization: 你的密钥' http://127.0.0.1:9010/health
```

代理默认只监听本机。控制面与节点不在同一台机器时，应通过 WireGuard、Tailscale 等私网访问，并把 `XRAY_AGENT_LISTEN` 绑定到私网 IP。不要把未加密的代理端口直接暴露到公网。

## 3. 在管理后台添加节点

选择 `VLESS + REALITY`，填写：

- 节点地址和端口
- SNI、REALITY 公钥、Short ID、客户端指纹与 Flow
- “节点监控与控制 API”为代理地址，例如 `http://10.0.0.8:9010`
- “API 密钥”为 `XRAY_AGENT_SECRET`

API 服务设置 `NODE_SYNC_ENABLED=true` 后，每分钟同步用户、流量与在线状态。也可以在节点编辑抽屉里点击“立即同步”。Xray 重启会丢失通过 HandlerService 动态加入的用户；下一次自动或手动同步会恢复。
