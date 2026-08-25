# ADR 0001: Expand-and-contract control-plane models

- Status: Accepted
- Date: 2026-08-24

## Context

Legacy plans, resource pools, subscriptions, and mutable remaining-traffic
fields combine catalog, access, entitlement, and accounting responsibilities.
Replacing them in place would risk removing node access or changing active
customer quota while Hysteria2 and Xray continue serving traffic.

## Decision

`CatalogProduct/CatalogOffer` and `EntitlementGrant/QuotaBucket` are the source
models for new behavior. `AccessProfileNode` is the source relationship for
node access. Legacy models and HTTP routes remain compatibility adapters for at
least one stable observation window.

Every production migration follows this order:

1. Add nullable fields, tables, and non-blocking indexes.
2. Capture the pre-migration effective state.
3. Backfill idempotently.
4. Compare entitlements, remaining quota, and access sets in both directions.
5. Switch reads only after the comparison succeeds.
6. Remove compatibility storage in a later release, never in the cutover.

The resource-pool migration captures the union of existing direct bindings and
pool members before backfill, then compares it with the resulting direct set
using bidirectional `EXCEPT`. Any difference aborts the migration.

## Consequences

- Rollback switches the release and read path; it does not reverse usage data.
- The migration does not restart or edit Hysteria2 or Xray.
- Existing sessions remain on their endpoints. Priority affects only future
  selection.
- Duplicate compatibility writes are temporary and must not gain new rules.
