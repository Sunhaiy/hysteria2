import { resolvePlanRedemptionWindow } from './plan-redemption-policy';

describe('plan redemption policy', () => {
  const redeemedAt = new Date('2026-01-31T08:00:00.000Z');

  it('extends an unexpired subscription when renewing the same plan', () => {
    const result = resolvePlanRedemptionWindow({
      mode: 'RENEW',
      currentPlanId: 'plan_pro',
      targetPlanId: 'plan_pro',
      currentEndsAt: new Date('2026-04-30T08:00:00.000Z'),
      redeemedAt,
      intervalMonths: 3,
      durationDays: 30,
    });
    expect(result).toMatchObject({ renewsCurrent: true, forceReplace: false });
    expect(result.endsAt.toISOString()).toBe('2026-07-30T08:00:00.000Z');
  });

  it('starts now and clamps month-end when replacement is selected', () => {
    const result = resolvePlanRedemptionWindow({
      mode: 'REPLACE',
      currentPlanId: 'plan_pro',
      targetPlanId: 'plan_pro',
      currentEndsAt: new Date('2026-12-31T08:00:00.000Z'),
      redeemedAt,
      intervalMonths: 1,
      durationDays: 30,
    });
    expect(result).toMatchObject({ renewsCurrent: false, forceReplace: true });
    expect(result.endsAt.toISOString()).toBe('2026-02-28T08:00:00.000Z');
  });
});
