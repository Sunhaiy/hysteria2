# Machine-based traffic metering

Supersedes ADR 0011 for future usage imports. Billing uses the maximum of
the NodeServer rate and the member override (default 1x), independently of
plan, grant, and traffic-pack snapshots. All protocol endpoints on one server
share its rate. Existing top-tier machines are initialized to 2x, others to
1x. New machines default by their name; subsequent renaming preserves the
configured rate. Unassigned legacy endpoints default by their label until
assigned to a server.

Tier detection uses a leading `[顶级]`, `【顶级】`, or `顶级` marker. A label
such as `[中级]非特殊情况，请用顶级线路` is intermediate, not top tier.

The rate is read once per import transaction. Replayed batches do not charge
again. Fractional-byte carry, quota allocation order, raw physical traffic,
and immutable historical rollups remain intact. Configuration changes affect
subsequent imports, not already posted usage. Infrastructure traffic limits
continue to use physical bytes, never multiplied billing bytes.

Product and order snapshot fields remain readable for historical audit; they
no longer determine consumption. Server rates are configured in node operations,
member overrides in customer administration.

API: `POST /api/admin/node-ops/servers` and `PUT /api/admin/node-ops/servers/:id`
accept optional `trafficMultiplier` (0.1–100, up to four decimal places).
Omitting it on update preserves the configured rate. The operations overview
returns each server's `trafficMultiplier`. Updates are audited transactionally.
Customer `trafficMultiplier` denotes the member override; the global
`effectiveTrafficMultiplier` is null because the actual rate depends on the
chosen machine, with `trafficBillingMode: machine_user_max` identifying this rule.

Migration backfill can be exercised without persisting fixtures using
`psql -f apps/api/prisma/machine-traffic-migration.check.sql` against a local DB.
