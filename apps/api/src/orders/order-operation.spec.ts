import { orderOperation } from './order-operation';

describe('order business operation', () => {
  it.each([
    ['initial', '新开'],
    ['renewal', '续费'],
    ['scheduled_switch', '到期切换'],
    ['immediate_switch', '立即切换'],
  ])('uses immutable %s checkout decision over legacy kind', (mode, label) => {
    expect(
      orderOperation({
        kind: 'RENEWAL',
        epayPaymentAttempt: {
          entitlementSnapshot: {
            purchaseMode: 'group_buy',
            planActivationMode: mode,
          },
        },
      }),
    ).toBe(label);
  });
  it('identifies quota resets before legacy renewal kind', () => {
    expect(orderOperation({ kind: 'RENEWAL', note: 'PLAN_QUOTA_RESET' })).toBe(
      '流量重置',
    );
  });
  it('keeps wallet and complimentary checkout decisions', () => {
    expect(
      orderOperation({ kind: 'RENEWAL', note: 'PLAN_ACTIVATION:initial' }),
    ).toBe('新开');
  });
  it('does not pretend an ambiguous historical purchase was a renewal', () => {
    expect(orderOperation({ kind: 'RENEWAL' })).toBe('套餐购买');
  });
});
