export type PlanRedemptionMode = 'RENEW' | 'REPLACE';

export function resolvePlanRedemptionWindow(input: {
  mode: PlanRedemptionMode;
  currentPlanId?: string | null;
  targetPlanId: string;
  currentEndsAt?: Date | null;
  redeemedAt: Date;
  intervalMonths?: number | null;
  durationDays: number;
}) {
  const renewsCurrent =
    input.mode === 'RENEW' && input.currentPlanId === input.targetPlanId;
  const startsAt =
    renewsCurrent &&
    input.currentEndsAt &&
    input.currentEndsAt > input.redeemedAt
      ? input.currentEndsAt
      : input.redeemedAt;
  return {
    renewsCurrent,
    forceReplace: input.mode === 'REPLACE',
    startsAt,
    endsAt: input.intervalMonths
      ? addUtcMonthsClamped(startsAt, input.intervalMonths)
      : addUtcDays(startsAt, input.durationDays),
  };
}

function addUtcDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addUtcMonthsClamped(value: Date, months: number) {
  const result = new Date(value);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}
