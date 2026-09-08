export type PlanRedemptionMode = 'RENEW' | 'REPLACE';

export function resolvePlanRedemptionWindow(input: {
  mode: PlanRedemptionMode;
  currentPlanId?: string | null;
  targetPlanId: string;
  currentStartsAt?: Date | null;
  currentEndsAt?: Date | null;
  redeemedAt: Date;
  intervalMonths?: number | null;
  durationDays: number;
}) {
  const renewsCurrent =
    input.mode === 'RENEW' && input.currentPlanId === input.targetPlanId;
  const extendsCurrentTerm = Boolean(
    renewsCurrent &&
    input.currentEndsAt &&
    input.currentEndsAt > input.redeemedAt,
  );
  const startsAt =
    extendsCurrentTerm && input.currentEndsAt
      ? input.currentEndsAt
      : input.redeemedAt;
  return {
    renewsCurrent,
    forceReplace: input.mode === 'REPLACE',
    startsAt,
    endsAt: input.intervalMonths
      ? addUtcMonthsClamped(
          startsAt,
          input.intervalMonths,
          extendsCurrentTerm ? input.currentStartsAt?.getUTCDate() : undefined,
        )
      : addUtcDays(startsAt, input.durationDays),
  };
}

function addUtcDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addUtcMonthsClamped(
  value: Date,
  months: number,
  anchorDay = value.getUTCDate(),
) {
  const result = new Date(value);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(anchorDay, lastDay));
  return result;
}
