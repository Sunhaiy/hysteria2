# ADR 0006: Worker-owned server traffic guard

- Status: Accepted
- Date: 2026-08-28

## Context

Operators need a per-server monthly physical-traffic limit to prevent provider
overage. A physical server can expose both Hysteria2 and VLESS endpoints, so a
per-node limit understates the server's actual usage and can leave an exhausted
server in refreshed subscriptions.

## Decision

- Traffic protection is disabled by default and configured per `NodeServer`.
- Cycles reset at Beijing midnight on the configured day from 1 through 28.
- Usage is the sum of upload plus download physical traffic across every live
  endpoint on the server. `UsageRollup.rawBytes` is preferred, with
  `txBytes + rxBytes` as the compatibility fallback.
- The API only stores the policy. The single worker evaluates limits and queues
  one idempotent `NodeRuntimeCommand(STOP)` for each managed endpoint.
- At the threshold, the worker first disables the server and every endpoint in
  one transaction. Refreshed subscriptions and authentication stop offering the
  server even when its remote agent is unreachable.
- Retry keys include the server, endpoint, billing cycle, observed runtime
  state, and a one-minute retry window. Concurrent polls cannot create duplicate
  active commands, while transient failures can be retried.
- A new traffic cycle does not automatically start a stopped service.

## Consequences

- Existing servers and users are unaffected until an administrator enables a
  policy.
- Hysteria2 requires configured runtime-control credentials for the process to
  stop; VLESS uses its existing managed runtime adapter. Missing runtime control
  never prevents the local access lifecycle from being disabled.
- Reaching a limit disconnects active sessions on the server, so the admin UI
  states this consequence before enabling the policy.
