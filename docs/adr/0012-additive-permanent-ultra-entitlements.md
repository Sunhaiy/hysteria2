# ADR 0012: Additive permanent Ultra entitlements

## Status

Accepted.

## Decision

Ultra is a separate catalog series implemented as an additive traffic-pack
grant with a permanent entitlement boundary and monthly-reset quota buckets.
It never replaces the member's standard plan. A user has at most one active
Ultra grant, enforced by the `ULTRA` active slot, while canceled grants retain
their order and usage history.

The three initial tiers share one exclusive access profile. Moving a node into
that profile removes its standard catalog bindings in the same transaction.
Authentication, subscription generation, speed limits, and usage allocation
all select grants through the requested node, so Ultra nodes can consume only
Ultra buckets and standard nodes cannot consume them.

An upgrade mutates the active grant in place, preserves the first purchase as
the monthly reset anchor, and adds only the quota difference to the current
bucket. The server derives the payable price from immutable tier price
snapshots. Full refund of any linked Ultra order cancels the whole active grant
and releases the active slot; partial refunds do not change the entitlement.

## Consequences

- Month-end purchase anchors clamp to the last valid day of shorter months.
- Unused Ultra quota does not carry into the next bucket.
- Product edits do not alter sold price, traffic, multiplier, or reset anchors.
- A member can use Ultra without a standard plan and can repurchase after a
  full-refund cancellation.
- Ultra products can be deployed as drafts with an empty node profile without
  changing existing subscriptions, nodes, quotas, or node processes.
