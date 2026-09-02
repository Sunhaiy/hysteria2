# ADR 0011: Meter usage by entitlement multiplier

## Status

Accepted.

## Decision

Each `EntitlementGrant` snapshots the traffic multiplier from the fulfilled
order, and each quota bucket freezes that value when it is created. Usage is
metered as it crosses quota buckets, using the higher of the current member
override and the bucket snapshot. A rollup spanning different grants stores the
physical-byte-weighted effective multiplier while its allocations preserve the
exact accounted bytes charged to each bucket.

Existing grants are backfilled from their closest applied order snapshot. Plan
grants fall back to the access-account plan multiplier, while traffic-pack
grants fall back to the catalog product multiplier. Historical rollups remain
immutable; confirmed undercharges are recovered with idempotent quota
adjustment entries.

## Consequences

- A traffic pack can charge its purchased multiplier without changing the
  account's plan multiplier.
- One import batch can safely cross plan and traffic-pack buckets with different
  multipliers.
- Product edits do not change the multiplier of an existing entitlement.
- Historical compensation remains auditable and does not rewrite usage history.
