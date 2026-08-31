import { BillingPeriod } from '@prisma/client';

const permanentEntitlementTimestamp = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

export function isPermanentBillingPeriod(
  period: BillingPeriod | null | undefined,
) {
  return period === BillingPeriod.ONE_TIME;
}

export function permanentEntitlementEnd() {
  return new Date(permanentEntitlementTimestamp);
}
