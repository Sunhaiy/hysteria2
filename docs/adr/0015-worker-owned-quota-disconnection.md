# Worker-owned quota disconnection

Traffic accounting and live disconnection are separate outcomes. Successful
collection does not prove a depleted user was disconnected.

Usage sync persists NodeAccessRevocation work before acknowledging restricted
traffic. A failed queue write leaves the batch replayable. Tasks coalesce by
user/endpoint, retain retry backoff, use compare-and-set leases, and recover after
worker crashes. Failures retry indefinitely with a capped 60-second delay and
remain queryable with attempts/lastError; first and sixth failures enter audit.
No in-memory-only retry or swallowing kicked:false constitutes completion.

Candidate nodes include every active nonretired node and the reporting endpoint,
not only historical PlanBinding rows. Before each attempt the worker resolves
current per-node entitlements including packs and legacy compatibility. Restored
or other valid access cancels the task. Provisioning and revocation serialize per
node in the single worker to prevent stale provision snapshots undoing revocation.
The permission decision is not frozen in the queue. Manual admin disconnects keep
their intentionally forced behavior, but also stop relying on PlanBinding.

Worker scans recent online presence for expiration without new usage. Fast traffic
collection runs independently from the full provisioning sweep. Metering precedes
provisioning so a provisioning error cannot hide consumption. Local environments
with node sync disabled do not run these collectors or remote enforcement loops.

Hysteria uses its real session kick. VLESS requires the verified patched core and
Agent described in ops/xray/SESSION-REVOCATION.md. A stock core cannot be marked
successful simply because authentication was removed. Polling/network latency
still permits in-flight bytes; this is not node-local hard quota enforcement.

Validation covers the real PostgreSQL migration, concurrent task claims, expired
leases, cross-worker restart, retry without new usage, restoration before retry,
different valid node access, plus live two-user protocol sessions.

