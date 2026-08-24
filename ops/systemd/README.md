# Control plane services

Install these units after the release symlink points to a fully built release:

```bash
install -m 0644 ops/systemd/hysteria2-api.service /etc/systemd/system/
install -m 0644 ops/systemd/hysteria2-web.service /etc/systemd/system/
systemctl daemon-reload
systemctl restart hysteria2-api.service hysteria2-web.service
```

Verify that both processes loaded the selected release rather than a stale
working directory:

```bash
release="$(readlink -f /opt/hysteria2-control-plane/current)"
test "$(readlink -f /proc/$(systemctl show -p MainPID --value hysteria2-api.service)/cwd)" = "$release/apps/api"
test "$(readlink -f /proc/$(systemctl show -p MainPID --value hysteria2-web.service)/cwd)" = "$release/apps/web"
curl --fail http://127.0.0.1:4000/api/health/ready
curl --fail http://127.0.0.1:3001/admin/users
```

The direct Node commands are intentional. Running these services through
`pnpm` can require write access to the immutable release root during startup.
