# Snapshot and retry 易支付 settlement

## Status

Accepted.

## Decision

Each `EpayPaymentAttempt` stores the gateway URL, merchant identity, encrypted
signing key, exact amount, and catalog entitlement terms used at creation. A
callback verifies against that attempt rather than current settings, then
creates the order, compatibility entitlement, V2 grant, payment record, and
audit event in one serializable transaction.

External settlement rechecks lifetime purchase limits. A verified callback
whose entitlement cannot be applied remains unsettled, returns `fail`, and
records a retryable failure projection. It never creates a settled payment
record without its entitlement.

## Consequences

- Changing payment settings or catalog terms does not alter in-flight orders.
- Duplicate or concurrent callbacks create at most one order and payment.
- Persistent fulfillment failures are visible in audit data and continue to be
  retried by the gateway; a dedicated reconciliation console remains follow-up
  work.
