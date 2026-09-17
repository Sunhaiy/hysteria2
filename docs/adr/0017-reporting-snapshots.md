# ADR 0017: Half-hour operations reporting snapshots

Operations summary and physical server traffic are reporting projections, not
quota authorities. A single worker refreshes them at most every thirty minutes.
API reads use Redis snapshots and enqueue missing or stale historical months;
they never wait for a monthly UsageRollup scan. Missing data is explicitly pending,
and refresh failure leaves the previous successful snapshot intact. Responses
include generatedAt and stale; clients must not display missing reports as zero.

GET /api/admin/operations/summary and /traffic/servers now return
{ data, generatedAt, status: "ready" | "pending", stale }. The server-month query
remains a Shanghai calendar month. The worker checks requested months each minute.
This cache is rebuildable and deliberately separate from immutable billing data.

Real usage imports, online expiry checks and quota-disconnection retries retain
their previous schedules. An all-zero user counter does not require a rollup,
allocation or user lookup; its batch receipt is still persisted and acknowledged.
Replaying that batch must not bill again. Existing cycles and quota buckets do not
need write transactions/upserts just to read access; access reads live consumption.

The admin monthly statement uses existing finance queries with exclusive Shanghai
month boundaries. It distinguishes fulfilled online revenue, refunds, recorded
node costs and current wallet liability. Wallet/CDK/admin face values are not
counted again as online cash revenue. Missing cost entries are disclosed.
