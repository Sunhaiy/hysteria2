# Gate 易支付 activation with an isolated test payment

## Status

Accepted.

## Decision

Administrators save 易支付 credentials without changing the active checkout
channel, then complete a real ¥0.01 gateway test. The test uses dedicated
notification and return endpoints and persists an `EpayGatewayTestAttempt`.
It does not call commerce fulfillment and cannot create an order, payment
record, revenue, subscription, entitlement, or traffic pack.

A SHA-256 fingerprint covers the normalized gateway URL, merchant identity,
merchant key, and default payment type. Switching from store checkout to
易支付 requires a settled test with the current fingerprint. Any credential
change invalidates the previous test for activation purposes.

## Consequences

- A gateway can be tested without exposing members to an unverified channel.
- The test is a real one-cent charge and verifies redirect, signing, and both
  callback paths.
- Test payments remain outside financial reporting because they are gateway
  probes rather than product sales.
- Refund automation and failed-settlement reconciliation remain separate
  operational work.
