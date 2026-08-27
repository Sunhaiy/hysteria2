# Settle referral rewards only through plan CDK transactions

Referral rewards are qualified only by a successful plan CDK redemption and
are settled in the same database transaction as the order and plan entitlement.
This excludes wallet purchases, non-plan CDKs, and complimentary grants without
duplicating eligibility rules across callers. Any applied refund reverses the
whole reward once, but wallet recovery is capped at the inviter's current
balance and consumed traffic is never rewritten; the explicit unrecovered
amount is preferable to negative balances or retroactive usage changes.
