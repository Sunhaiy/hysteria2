import { decidePlanPurchasePolicy } from './plan-purchase-policy';

describe('standard plan purchase policy', () => {
  const now = new Date('2026-09-08T08:00:00.000Z');
  const currentPlan = {
    productId: 'product_start',
    productName: 'Start',
    legacyPlanId: 'plan_start',
    startsAt: new Date('2026-08-08T08:00:00.000Z'),
    endsAt: new Date('2026-10-08T08:00:00.000Z'),
  };

  it('starts immediately when the account has no current plan', () => {
    expect(
      decidePlanPurchasePolicy({
        now,
        currentPlan: null,
        targetProductId: 'product_start',
        targetLegacyPlanId: 'plan_start',
      }),
    ).toMatchObject({ mode: 'initial', effectiveAt: now, forfeitedDays: 0 });
  });

  it('renews the same plan after its current expiry', () => {
    expect(
      decidePlanPurchasePolicy({
        now,
        currentPlan,
        targetProductId: 'product_start',
        targetLegacyPlanId: 'plan_start',
      }),
    ).toMatchObject({
      mode: 'renewal',
      effectiveAt: currentPlan.endsAt,
      forfeitedDays: 0,
    });
  });

  it('schedules a different plan at current expiry by default', () => {
    expect(
      decidePlanPurchasePolicy({
        now,
        currentPlan,
        targetProductId: 'product_pro',
        targetLegacyPlanId: 'plan_pro',
      }),
    ).toMatchObject({
      mode: 'scheduled_switch',
      effectiveAt: currentPlan.endsAt,
      forfeitedDays: 0,
    });
  });

  it('switches a different plan now only when explicitly selected', () => {
    expect(
      decidePlanPurchasePolicy({
        now,
        currentPlan,
        targetProductId: 'product_pro',
        targetLegacyPlanId: 'plan_pro',
        preference: 'immediate_switch',
      }),
    ).toMatchObject({
      mode: 'immediate_switch',
      effectiveAt: now,
      forfeitedDays: 30,
    });
  });
});
