# Reconcile 易支付 through the merchant active-query contract

## Status

Accepted.

## Decision

The single control-plane worker queries unsettled customer and gateway-test
attempts through the merchant endpoint derived from each immutable gateway
snapshot. The request uses the attempt's merchant identifier and encrypted key
snapshot. Redirects are rejected, responses are size and time bounded, and no
signed URL or merchant key is stored in errors or logs.

Only a correctly signed response whose order number, integer-cent amount,
payment channel, and status all match the attempt can change state. A paid
result enters the same serializable settlement method used by callbacks.
Pending results remain pending, closed results release the active purchase key,
and missing, malformed, unsigned, or unreachable results only update the query
failure projection.

The reconciler covers recent pending, expired, and retryable failed attempts so
a delayed or lost callback can still complete without creating a second order.
Unique order, gateway trade, payment, and entitlement constraints remain the
final concurrency guard.

## Consequences

- Callback and polling races can fulfill a purchase at most once.
- Credential and catalog changes do not alter in-flight validation or grants.
- Query failures are visible without exposing secrets.
- The worker remains disabled during dark deployment. Enabling it does not
  change the site's checkout mode; both channel tests and a real signed query
  still precede the separate checkout-mode switch.
