# Per-user session revocation

The stock Xray `RemoveUserOperation` removes VLESS authentication, but does not
close ordinary already authenticated streams. A successful removed-user count
must not be presented as a successful live disconnect.

`build-session-core.sh` builds pinned upstream commit
`d2758a023cd7f4174a5a5fa4ff66e487d4342ba0` (v26.3.27) with
`session-revocation.patch` and the two `user_sessions*.go` overlays. The patch
registers authenticated VLESS sessions, cancels forwarding and closes only the
removed user's connections. Registration and removal share a mutex; identity is
the user instance rather than just email, so an old handshake or cleanup cannot
survive a delete/re-add or disconnect the replacement account. Multiplexed traffic
shares the authenticated parent context/connection and is canceled with it.

The running binary's version marker is `suxin-session-revoke-v1`. The node Agent
verifies `/proc/<actual systemd MainPID>/exe version` before removing users. It
returns HTTP 503 if the running core lacks the capability, even when a new binary
has already replaced the on-disk executable. No permission or capability is
inferred from an environment flag. A successful `/kick` response includes
`sessionRevocation: "suxin-session-revoke-v1"`; the API requires it for VLESS.

## Validation

```sh
bash ops/xray/build-session-core.sh /absolute/build-output
node ops/xray/check-disconnect.mjs /absolute/build-output/xray
node ops/hysteria/check-disconnect.mjs /path/to/hysteria /path/to/openssl
```

The real-core VLESS test starts two local authenticated TCP streams. Removing A
must close A's existing connection within two seconds, deny a new A connection,
keep B alive, and allow A after restoration. It fails against stock v26.3.27 and
passes against the patched binary. Hysteria's equivalent test uses the official
v2.9.3 server/client, an isolated HTTP auth server and real `/kick`.

These fixtures use local temporary ports and synthetic credentials, never a
customer credential. Their temporary server/client processes and files are
removed on exit. No production service is restarted by the checks.

## Rollout

Back up the database and current node binaries/configurations. Apply the additive
`20260915150000_node_access_revocation` migration. Validate on a restored copy.
Deploy the core and Agent to one VLESS instance at a time, validate its running
version, then release the API/worker. A core replacement requires restarting that
specific instance: existing sessions on that instance briefly reconnect. Do not
restart whole machines, other Xray instances, or Hysteria to apply the VLESS patch.
Do not claim a zero-interruption upgrade of an already running stock binary.

Once worker runs, inspect NodeAccessRevocation pending/running counts, attempts
and lastError; audit action `node.quota_disconnect.failed` records first and sixth
failures. Keep monitoring overage batches and stream closure, not just healthy
traffic imports. If an old core must be rolled back, the new Agent will correctly
report unconfirmed disconnection and leave tasks retryable.

This fixes sustained traffic on revoked sessions; centralized polling still has
an in-flight traffic window (fast collection starts every 10 seconds after the
previous pass finishes, plus processing/network delay). Strict zero-byte overrun
requires node-local quota reservation across machines, a different architecture.

