# ADR 0004: Agent-backed node runtime control

- Status: Accepted
- Date: 2026-08-25

## Context

Changing `Node.active` controls subscription generation, authentication, and
automatic endpoint selection. It does not stop a Hysteria2 or Xray process and
must not be presented as if it did. Direct systemd calls from an API request
would also couple page latency to a node and make retries unsafe.

## Decision

- Access lifecycle and runtime service state are separate controls.
- The API persists a `NodeRuntimeCommand` and returns HTTP 202.
- The single sync worker claims commands and calls the node agent.
- A command succeeds only after the agent observes the requested systemd state.
- The agent maps `xray` and `hysteria2` logical names to environment-owned
  systemd unit names. HTTP callers cannot submit a unit or shell command.
- Start and stop commands use idempotency keys. Interrupted worker commands are
  recovered because both systemd operations are idempotent.
- Starting an active VLESS endpoint immediately requests user synchronization.
- Runtime status is projected onto `Node` and refreshed independently every 30
  seconds. Agent failures update the error without inventing a new state.

## Consequences

- Stopping access leaves existing connections alone; stopping the service
  disconnects them and requires explicit confirmation.
- Hysteria2 endpoints using a native statistics API need a separate control
  agent URL and secret.
- A release is blocked until every managed agent exposes the status endpoint.
- Production smoke tests are allowed only on a dedicated endpoint whose initial
  runtime state is inactive.
