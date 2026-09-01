# Control plane services

Install these units after the release symlink points to a fully built release:

```bash
install -m 0644 ops/systemd/hysteria2-api.service /etc/systemd/system/
install -m 0644 ops/systemd/hysteria2-sync-worker.service /etc/systemd/system/
install -m 0644 ops/systemd/hysteria2-web.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now hysteria2-sync-worker.service
systemctl restart hysteria2-api.service hysteria2-web.service
```

The shared `app.env` must keep node work in the worker only:

```bash
NODE_SYNC_ENABLED=true
NODE_OPERATIONS_ENABLED=true
NODE_SYNC_INTERVAL_MS=60000
NODE_PRESENCE_INTERVAL_MS=15000
NODE_HEALTH_INTERVAL_MS=60000
NODE_CHECK_REQUEST_POLL_MS=2000
NODE_RUNTIME_CONTROL_ENABLED=true
NODE_RUNTIME_COMMAND_POLL_MS=2000
NODE_RUNTIME_STATUS_INTERVAL_MS=30000
DESTINATION_RETENTION_DAYS=7
ONLINE_RETENTION_DAYS=7
AUTH_EVENT_RETENTION_DAYS=30
DATA_CLEANUP_INTERVAL_MS=86400000
BACKUP_DIR=/opt/hysteria2-control-plane/shared/backups
BACKUP_RETENTION_COUNT=3
BACKUP_DAILY_HOUR=3
BACKUP_TIME_ZONE=Asia/Shanghai
BACKUP_RESTORE_ENABLED=true
BACKUP_MAINTENANCE_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/postgres
```

Create `BACKUP_DIR` before startup and grant it to the service account:

```bash
install -d -m 0750 -o hysteria2 -g hysteria2 /opt/hysteria2-control-plane/shared/backups
```

Install the PostgreSQL client utilities (`pg_dump`, `pg_restore`, and `psql`)
on the control-plane host. See `ops/backup/README.md` for restore requirements.

Run exactly one `hysteria2-sync-worker.service` instance. During a release,
stop the old worker only after the new API and web health checks pass, then
start the new worker before switching the `current` symlink. Do not restart the
Hysteria2 or Xray units as part of this procedure.

Verify that both processes loaded the selected release rather than a stale
working directory:

```bash
release="$(readlink -f /opt/hysteria2-control-plane/current)"
test "$(readlink -f /proc/$(systemctl show -p MainPID --value hysteria2-api.service)/cwd)" = "$release/apps/api"
test "$(readlink -f /proc/$(systemctl show -p MainPID --value hysteria2-web.service)/cwd)" = "$release/apps/web"
test "$(readlink -f /proc/$(systemctl show -p MainPID --value hysteria2-sync-worker.service)/cwd)" = "$release/apps/api"
curl --fail http://127.0.0.1:4000/api/health/ready
curl --fail http://127.0.0.1:3001/admin/users
```

After cutover, compare the Hysteria2/Xray PIDs, online totals, authorized user
counts, and a real subscription response with the values recorded before the
release. A changed node PID or a reduced authorized-user set blocks completion.

Before starting the new control plane, upgrade each node Agent and verify its
runtime capability. Restarting the Agent is allowed; do not restart the node
service. Create an inventory from `ops/release/agent-inventory.example` outside
the release directory with mode `0600`, then run:

```bash
AGENT_CHECKS_FILE=/etc/hysteria2-agent-inventory \
SUBSCRIPTION_PROBE_URL='https://example.com/subscribe/existing-token' \
NODE_RUNTIME_UNITS='hysteria-server.service xray.service' \
BASELINE_FILE=/var/tmp/hysteria2-before-release.txt \
bash ops/release/control-plane-preflight.sh
```

Run the same script after the atomic switch with
`COMPARE_BASELINE_FILE=/var/tmp/hysteria2-before-release.txt` and a different
`BASELINE_FILE`. The comparison blocks on changed Hysteria2/Xray PIDs, reduced
Xray authorization counts, or a changed subscription hash. Online totals are
recorded for inspection but are not a hard equality check because sessions can
change naturally during a release.

`ops/release/runtime-control-smoke.sh` is only for a dedicated test endpoint
whose initial runtime state is inactive. It refuses to run otherwise and
restores the inactive state before exit. Never point it at a production-serving
endpoint.

The direct Node commands are intentional. Running these services through
`pnpm` can require write access to the immutable release root during startup.
