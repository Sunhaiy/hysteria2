# Site checkout channels and unified order center

## Status

Accepted.

## Decision

Member checkout always sends an explicit `alipay` or `wxpay` payment type and
opens the signed gateway form in a separate browser window. Settlement remains
an atomic operation that creates the compatibility order, payment record, and
entitlement together.

易支付 activation requires successful one-cent tests for both channels and an
enabled merchant-specific active-query reconciler. Until the query contract is
implemented and tested, store checkout remains active.

The admin order center is a read projection over existing order, payment,
refund, and payment-attempt records. It does not introduce a second ledger.
Existing CDKs remain redeemable; new plan and traffic-pack CDKs are blocked
only while 易支付 checkout is active.

## Consequences

- Channel selection happens on this site instead of at the gateway selector.
- Missing callbacks cannot be accepted as an operationally complete launch.
- Historical store links, codes, orders, and entitlements remain intact for
  rollback and customer support.
- Revenue summaries use Asia/Shanghai fulfillment time and subtract applied
  refunds in the same reporting window.
