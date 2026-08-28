# Hysteria2 UDP port hopping

This unit adds an idempotent UDP `PREROUTING` redirect without restarting the
Hysteria2 process. The original Hysteria2 port remains available for existing
subscriptions.

Install the three runtime files, then enable the unit:

```bash
install -m 0755 hysteria-port-hopping.sh /usr/local/sbin/hysteria-port-hopping
install -m 0644 hysteria-port-hopping.service /etc/systemd/system/hysteria-port-hopping.service
install -m 0644 hysteria-port-hopping.env.example /etc/hysteria-port-hopping.env
systemctl daemon-reload
systemctl enable --now hysteria-port-hopping.service
```

Verify the rule and packet counters before enabling port hopping in the control
plane:

```bash
systemctl is-active hysteria-port-hopping.service
iptables -t nat -C PREROUTING -p udp --dport 20000:29999 \
  -j REDIRECT --to-ports 59620
iptables -t nat -L PREROUTING -n -v -x
```

Disable the unit to remove only the hopping redirect. This does not stop or
restart Hysteria2:

```bash
systemctl disable --now hysteria-port-hopping.service
```
