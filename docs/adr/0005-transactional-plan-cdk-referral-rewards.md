# Settle referral rewards only through plan CDK transactions

Referral rewards are qualified only by a successful plan CDK redemption and
are settled in the same database transaction as the order and plan entitlement.
This excludes wallet purchases, non-plan CDKs, and complimentary grants without
duplicating eligibility rules across callers. Any applied refund reverses the
whole reward once, but wallet recovery is capped at the inviter's current
balance and consumed traffic is never rewritten; the explicit unrecovered
amount is preferable to negative balances or retroactive usage changes.

New referral attributions snapshot a configurable cashback percentage in basis
points. Settlement calculates the inviter reward from the qualifying order
amount, rounds down to integer cents, and stores that actual amount before
writing wallet ledgers. Existing pending attributions without a percentage
snapshot retain their original fixed reward so changing the policy cannot
rewrite an earlier promise.
