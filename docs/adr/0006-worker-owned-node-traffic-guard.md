# ADR 0006: Worker-owned node traffic guard

- Status: Accepted
- Date: 2026-08-28

## Context

Operators need a per-node monthly physical-traffic limit to prevent provider
overage. Enforcing the limit inside an admin request would couple runtime
control to page latency, while disabling the node would also change active
subscriptions and access permissions.

## Decision

- Traffic protection is disabled by default and configured per node.
- Cycles reset at Beijing midnight on the configured day from 1 through 28.
- Usage is upload plus download physical traffic. `UsageRollup.rawBytes` is
  preferred, with `txBytes + rxBytes` as the compatibility fallback.
- The API only stores the policy. The single worker evaluates limits and queues
  an idempotent `NodeRuntimeCommand(STOP)` through the existing runtime-control
  module.
- Retry keys include the billing cycle, observed runtime state, and a one-minute
  retry window. Concurrent polls cannot create duplicate active commands, while
  transient failures can be retried.
- Automatic enforcement stops the runtime service only. It does not change the
  node access lifecycle, remove subscription entries, or alter user traffic.
- A new traffic cycle does not automatically start a stopped service.

## Consequences

- Existing nodes and users are unaffected until an administrator enables a
  policy.
- Hysteria2 requires configured runtime-control credentials; VLESS uses its
  existing managed runtime adapter.
- Reaching a limit disconnects active sessions on that node, so the admin UI
  states this consequence before enabling the policy.
