# Control-plane release runbook

This release separates node access from the node process runtime:

- Stopping access removes an endpoint from new subscriptions, authentication,
  and automatic selection. Existing connections are not interrupted.
- Stopping a service asks the node Agent to stop the mapped systemd unit and
  disconnects current connections. Use it only after explicit confirmation.

Do not use a production endpoint for the runtime smoke test. The script refuses
to continue unless the selected endpoint initially reports `inactive`.

## 1. Prepare every node Agent

Build and install the Agent without restarting Xray or Hysteria2. Configure a
fixed logical-name allowlist in `/etc/hysteria2-xray-agent.env`, for example:

```dotenv
XRAY_AGENT_CONTROL_SERVICES=xray=xray.service,hysteria2=hysteria-server.service
```

Restart only the Agent and verify its status API for every managed service:

```bash
curl --fail -H "Authorization: $AGENT_SECRET" \
  "$AGENT_URL/service/status?service=xray"
```

The HTTP API accepts only the logical names `xray` and `hysteria2`; systemd
unit names cannot be supplied by a request.

## 2. Create the private inventory

Copy `agent-inventory.example` to `agent-inventory`. The first field must be the
database node ID; fill in every production Agent, its logical service, and the
expected `active` or `inactive` state. This keeps deliberately disabled
endpoints disabled. Restrict the file before adding secrets:

```bash
install -m 0600 /dev/null ops/release/agent-inventory
```

`agent-inventory` is ignored by Git. Keep it outside release artifacts after
the preflight has finished.

## 3. Record the pre-cutover baseline

Build the release and run database migrations first against an isolated restore
of the production backup. Then run the preflight against the currently active
release:

```bash
AGENT_CHECKS_FILE=ops/release/agent-inventory \
SUBSCRIPTION_PROBE_URL='https://example.com/api/portal/subscription/PROBE_TOKEN' \
NODE_RUNTIME_UNITS='xray.service hysteria-server.service' \
BASELINE_FILE=/var/lib/hysteria2-release/pre-cutover.txt \
bash ops/release/control-plane-preflight.sh
```

The preflight compares the private inventory with the production database and
decrypts Agent credentials at rest before comparison. It fails if a current
managed node is missing, extra, or has mismatched Agent credentials. Retired
nodes are deliberately excluded and must not remain in the private inventory.
It then requires healthy API/Web endpoints, completed Prisma migrations,
reachable Agent status endpoints in their declared state, a non-empty
subscription, and active control plane units. It records every remote service
PID, Agent service state, authorized VLESS user count, online count, and the
subscription hash. `NODE_RUNTIME_UNITS` is needed only for runtime services on
the same host as the control plane; remote node PIDs come from the Agent.

## 4. Cut over without touching node processes

1. Back up PostgreSQL and record the current release path.
2. Start API and Web from the new release on unused ports.
3. Confirm `GET /api/health/ready` returns HTTP 200.
4. Stop the old sync worker and start exactly one new sync worker.
5. Atomically switch Nginx to the new API/Web ports.
6. Do not restart Xray or Hysteria2 during this sequence.

Run the same preflight against the new release and compare it with the baseline:

```bash
RELEASE_DIR=/srv/hysteria2/releases/NEW_RELEASE \
AGENT_CHECKS_FILE=ops/release/agent-inventory \
SUBSCRIPTION_PROBE_URL='https://example.com/api/portal/subscription/PROBE_TOKEN' \
NODE_RUNTIME_UNITS='xray.service hysteria-server.service' \
COMPARE_BASELINE_FILE=/var/lib/hysteria2-release/pre-cutover.txt \
BASELINE_FILE=/var/lib/hysteria2-release/post-cutover.txt \
bash ops/release/control-plane-preflight.sh
```

The comparison fails if a remote node state/PID, local node PID, or subscription
body changes, or if the Agent reports fewer authorized VLESS users.

## 5. Verify runtime control

Use the admin node page to submit a status query for each endpoint. Confirm the
command progresses from `queued` to `succeeded` and the observed state is fresh.

Start/stop testing is allowed only on a dedicated inactive endpoint:

```bash
CONFIRM_ISOLATED_RUNTIME_TEST=isolated-node \
AGENT_URL="$AGENT_URL" AGENT_SECRET="$AGENT_SECRET" SERVICE=xray \
bash ops/release/runtime-control-smoke.sh
```

The smoke script starts the endpoint, verifies `active`, stops it, verifies
`inactive`, and attempts to restore `inactive` if interrupted.

## Rollback

Switch Nginx back to the previous API/Web release and return ownership to its
single worker. Do not roll back user usage data and do not restart node runtime
services. Keep the additive runtime-control migration in place; the previous
release ignores the added tables and columns.
