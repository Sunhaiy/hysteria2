# Wallet, entitlement, and paid-fulfillment ownership

## Decision

Balance changes use the transaction-scoped API in `wallet/wallet-ledger.ts`.
It locks the user row, validates integer cents and non-negative balances, writes
the legacy compatibility row, and appends an immutable `WalletLedgerEntry` with
before and after balances plus an idempotency key. Feature modules must not
write user balances or either wallet ledger directly.

`EntitlementService` owns entitlement grants, quota buckets, quota adjustments,
revocation, access resolution, and active access-snapshot propagation. Commerce,
catalog, referrals, check-in, group-buy, and customer administration request
those changes through its public transaction-aware methods.

External payment and entitlement fulfillment are separate state machines. A
signed payment that can be fulfilled transitions to `APPLIED`. Retryable errors
transition to `RETRYING`. A paid order that can no longer be fulfilled creates
one idempotent `EpayRefundAttempt` and transitions to `REFUND_PENDING`; confirmed
refund becomes `REFUNDED`. Missing immutable credentials or unresolved refund
failure becomes `MANUAL_REVIEW` and is visible in the order exception view.

## Consequences

- Wallet purchases do not produce referral cashback, avoiding circular credit.
- Partial refunds recover cashback proportionally; bonus traffic is revoked on
  full refund only.
- Full refunds revoke only unused linked entitlement or reset credit. Consumed
  usage and historical allocation rows remain immutable.
- A late duplicate successful group payment never creates a second entitlement;
  it enters the same compensation-refund workflow.
- Account deletion forfeits positive balance through the immutable ledger and
  closes active group participation before anonymizing the account.
- Old Epay attempts without a complete credential snapshot require manual
  handling and never use current merchant credentials.
