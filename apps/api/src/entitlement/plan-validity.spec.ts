import { EntitlementService } from './entitlement.service';

describe('admin plan validity', () => {
  beforeEach(() =>
    jest.useFakeTimers().setSystemTime(new Date('2026-09-20T00:00:00Z')),
  );
  afterEach(() => jest.useRealTimers());
  function fixture() {
    const startsAt = new Date('2026-09-01T00:00:00Z');
    const endsAt = new Date('2026-10-01T00:00:00Z');
    const grant = {
      id: 'grant',
      userId: 'user',
      kind: 'PLAN',
      startsAt,
      endsAt,
      resetAnchorAt: startsAt,
      legacySubscriptionId: 'sub',
      quotaBuckets: [
        {
          id: 'bucket',
          startsAt,
          endsAt,
          grantedBytes: 100n,
          consumedBytes: 30n,
        },
      ],
    };
    const tx = {
      entitlementGrant: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(grant)
          .mockResolvedValue(null),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      quotaBucket: { update: jest.fn() },
      subscription: { update: jest.fn() },
      subscriptionCycle: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'cycle', startsAt, endsAt }]),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const service = new EntitlementService({
      $transaction: (fn: (client: typeof tx) => unknown) => fn(tx),
    } as never);
    const input = {
      endsAt: '2026-11-01T00:00:00.000Z',
      expectedEndsAt: endsAt.toISOString(),
      reason: '客服补偿有效期',
    };
    return { service, tx, input };
  }
  it('extends total validity without giving current cycle another month or clearing usage', async () => {
    const { service, tx, input } = fixture();
    await service.updatePlanValidity('user', 'grant', input, 'admin');
    expect(tx.quotaBucket.update).toHaveBeenCalledWith({
      where: { id: 'bucket' },
      data: { endsAt: new Date('2026-10-01T00:00:00Z') },
    });
    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub' },
      data: { endsAt: new Date(input.endsAt) },
    });
    expect(tx.auditLog.create).toHaveBeenCalled();
  });
  it('shortens bucket and legacy cycle boundaries together', async () => {
    const { service, tx, input } = fixture();
    input.endsAt = '2026-09-25T00:00:00.000Z';
    await service.updatePlanValidity('user', 'grant', input, 'admin');
    expect(tx.quotaBucket.update).toHaveBeenCalledWith({
      where: { id: 'bucket' },
      data: { endsAt: new Date(input.endsAt) },
    });
    expect(tx.subscriptionCycle.update).toHaveBeenCalledWith({
      where: { id: 'cycle' },
      data: { endsAt: new Date(input.endsAt) },
    });
  });
  it('rejects a stale form after concurrent renewal', async () => {
    const { service, tx, input } = fixture();
    input.expectedEndsAt = '2026-09-30T00:00:00Z';
    await expect(
      service.updatePlanValidity('user', 'grant', input, 'admin'),
    ).rejects.toThrow('已发生变化');
    expect(tx.entitlementGrant.update).not.toHaveBeenCalled();
  });
  it('rejects overlapping scheduled plans before any writes', async () => {
    const { service, tx, input } = fixture();
    tx.entitlementGrant.findFirst.mockResolvedValueOnce({ id: 'scheduled' });
    await expect(
      service.updatePlanValidity('user', 'grant', input, 'admin'),
    ).rejects.toThrow('重叠');
    expect(tx.entitlementGrant.update).not.toHaveBeenCalled();
  });
  it('binds the grant to the requested user', async () => {
    const { service, tx, input } = fixture();
    await service.updatePlanValidity('user', 'grant', input, 'admin');
    expect(tx.entitlementGrant.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'grant', userId: 'user', kind: 'PLAN', status: 'ACTIVE' },
      }),
    );
  });
});
