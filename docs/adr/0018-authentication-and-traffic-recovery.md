# Authentication observations and traffic acknowledgement recovery

Status: accepted, 2026-11-17.

## Permission responses and observations

Account, token, node and entitlement checks still determine every Hysteria
authentication decision. Optional last-used and AuthEvent writes run after the
decision, with at most two admitted observations per API process. There is no
unbounded in-memory queue. Database statement/lock deadlines and transaction
acquisition limits bound their use of the shared pool. Overload drops optional
observations with rate-limited warnings; it never grants access after a failed
permission check. These observations are not the billing ledger.

## Import and acknowledgement

The worker commits traffic accounting once per `(nodeId, externalId)`. It then
persists required quota-disconnection tasks and `enforcementQueuedAt` before
acknowledging the node. A restart retries pending acknowledgements before
claiming fresh traffic. Retrying an acknowledgement never reapplies billing.
The marker prevents repeated quota work for the same already-processed receipt.

Xray Agent preserves its last acknowledgement in a synced `.last-ack` sidecar
before deleting pending traffic. Repeated ACKs remain successful after response
loss or Agent restart, and cannot remove a newer pending batch. The pending-file
format remains compatible with the previous Agent. Only the single worker may
collect or acknowledge traffic; administrator sync requests are queued to it.

A bounded worker sweep also retries acknowledgements for nonretired disabled
endpoints without collecting new traffic, provisioning users or controlling
runtime services. Unknown historical receipts from older Agents remain APPLIED
and visible. They use backoff so they do not repeatedly consume every fast
collection interval. They are never declared acknowledged merely because they
are old or the node is reachable.

Native Hysteria compatibility uses read-and-clear only when the claim endpoint
explicitly returns 404/405, never on authentication errors or transient network
failures. Native read-and-clear cannot recover a lost response. Xray's existing
core counter reset still precedes Agent persistence, so an Agent/core crash in
that collection window can lose unpersisted counters. ACK recovery does not
claim to solve that separate collection limitation. Public billing should use
durable collection and preserve pending state during Agent installation.

## Independent synchronization health

User provisioning and traffic collection keep independent errors and successful
timestamps. `lastSyncError` remains an atomic compatibility projection of those
errors. Success in one flow cannot clear the other's failure. VLESS readiness
and health snapshots also require a fresh successful user sync, with a default
600-second budget; Hy2 has no provisioned user list.

## Billing across reset boundaries

An import materializes missing monthly quota periods inside its accounting
transaction at the receipt's `claimedAt`. A long-lived connection therefore
does not need to reauthenticate before new-period usage can be charged. A
missing compatibility subscription cycle is reconstructed from the matching
quota bucket snapshot, including prior consumption. Late old-period receipts
stay in their original period and never replace current-period summary totals.
Historical rollups are immutable; this change does not backcharge old overage.

Verification includes PostgreSQL billing/replay/concurrency tests, real HTTP
response-loss and database-failure injection, Agent persistence/restart tests,
and held-row-lock authentication tests. CI explicitly enables the database
tests instead of relying on the default skipped configuration.

The signed Agent update feature and independent updater executors remain active
(ADR 0016). These fixes preserve their tables, credentials and release history.
Agent upgrades must preserve pending traffic and the acknowledgement sidecar,
and must never restart the Hysteria2 or Xray proxy core.
