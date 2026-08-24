# 目的地遥测代理

该代理支持两种输入：Hysteria 2 JSON debug 日志中的 `TCP request` / `UDP request`，以及 Xray access log 中带 `email` 的 accepted 记录。代理仅上传用户 ID、域名或 IP、端口、传输协议和分钟级次数，不上传 URL 路径或内容。

构建并安装：

```bash
go build -trimpath -o hysteria2-destination-agent .
sudo install -m 0755 hysteria2-destination-agent /usr/local/bin/
sudo install -m 0644 hysteria2-destination-agent.service /etc/systemd/system/
sudo install -m 0600 destination-agent.env.example /etc/hysteria2-destination-agent.env
sudo systemctl daemon-reload
sudo systemctl enable --now hysteria2-destination-agent
```

Hysteria 2 节点设置 `HYSTERIA_LOG_LEVEL=debug`、`HYSTERIA_LOG_FORMAT=json` 并启用配置中的 `sniff`。VLESS 节点使用仓库的 Xray 示例配置启用 access log 和 sniffing。控制面只有在所有活动节点最近两分钟都成功上报后才开放查询。
