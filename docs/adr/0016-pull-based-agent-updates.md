# ADR 0016: Signed pull-based Agent updates

Status: accepted, 2026-09-15.

## Decision

`AgentUpdatesModule` owns release artifacts, installations, rollout order and
job state. It does not own subscriptions, usage accounting or proxy-core state.
An independent root systemd updater owns download, signature verification,
atomic executable replacement, Agent restart and rollback on each machine.

An installation is one `(NodeServer, serviceUnit)` pair, not a protocol endpoint.
All binary releases are immutable by version and CPU architecture. Artifacts,
SHA-256, canonical manifest and Ed25519 signature are stored together in Postgres
and included in full database backups. The signing private key is encrypted by
the existing settings cipher. Public keys are pinned during trusted one-time
SSH enrollment; the updater cannot replace its trust anchor through polling.

The administrator has `AGENT_UPDATES_MANAGE`. Machine credentials are separate
32-byte random tokens; only hashes are stored and lists/audits omit tokens.
Artifact access and reports are bound to the authenticated installation's job.

Postgres advisory transaction lock 7419230 serializes claims and mutations.
At most one job is in flight fleet-wide. The first selected installation is the
canary. Only confirmed success allows the next position to start. Failure pauses
the rollout and cancels queued jobs. Cancellation never interrupts an in-flight
replacement. There is deliberately no lease expiration: offline is not proof
that an installation stopped executing. An uncertain task keeps its slot.

The updater persists intent before replacement. Old binaries remain available;
the Agent entry is an atomically switched symlink. It verifies the signed
manifest, file size/hash, running executable hash and authenticated health
endpoint. It finishes local rollback even when the control plane is unreachable.
Terminal reporting is idempotent. Traffic-batch state is never rolled back or
deleted. Xray and Hysteria services are never restarted by the updater.

## Consequences

Bootstrap is required once per existing Agent. The first release supports Linux
amd64/arm64, root Agent services without command-line arguments, compatible Agent
environment variables and traffic state format. It does not update proxy cores
or the updater itself. A permanently lost node requires investigation; tasks are
not automatically discarded to make a dashboard appear successful.

Signing-key rotation and main-site backup recovery require operational care:
preserve the encryption key and pinned signing key. Restore only a backup whose
migrations match the release, and reconcile node journals before new rollouts.
An old backup must not be used to reissue already-completed update work blindly.

## Verification

PostgreSQL integration tests exercise concurrent claims, canary gating,
idempotency, authorization binding, immutable signatures, disconnects, failures
and cancellation. Linux updater tests exercise actual disk journals and symlink
replacement with injected process health/restart, including rollback, crash
recovery, tampering, interrupted downloads and lost terminal acknowledgements.
