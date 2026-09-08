import { BadRequestException } from '@nestjs/common';
import { CheckInService } from './check-in.service';

describe('CheckInService', () => {
  const config = { enabled: true, rewardBytes: 2 * 1024 ** 3 };

  function eligible() {
    return {
      id: 'grant-1',
      accessAccountId: 'account-1',
      quotaBuckets: [
        {
          id: 'bucket-1',
          grantedBytes: 100n,
          consumedBytes: 40n,
        },
      ],
      legacySubscription: {
        cycles: [{ id: 'cycle-1' }],
      },
    };
  }

  function setup(options: { existing?: boolean; eligible?: boolean } = {}) {
    const existing = options.existing
      ? {
          id: 'check-in-1',
          rewardBytes: BigInt(config.rewardBytes),
          claimedAt: new Date('2026-09-07T01:00:00.000Z'),
        }
      : null;
    const tx = {
      dailyCheckIn: {
        findUnique: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue({
          id: 'check-in-1',
          rewardBytes: BigInt(config.rewardBytes),
          claimedAt: new Date('2026-09-07T01:00:00.000Z'),
        }),
      },
      entitlementGrant: {
        findFirst: jest
          .fn()
          .mockResolvedValue(options.eligible === false ? null : eligible()),
      },
      quotaBucket: { update: jest.fn() },
      subscriptionCycle: { update: jest.fn() },
      quotaAdjustment: {
        create: jest.fn().mockResolvedValue({ id: 'adjustment-1' }),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const settings = {
      getDailyCheckInConfig: jest.fn().mockResolvedValue(config),
    };
    const entitlements = {
      creditQuotaBucket: jest.fn().mockResolvedValue({
        adjustmentId: 'adjustment-1',
        bucketId: 'bucket-1',
        subscriptionCycleId: 'cycle-1',
      }),
    };
    return {
      service: new CheckInService(
        prisma as never,
        settings as never,
        entitlements as never,
      ),
      tx,
      entitlements,
    };
  }

  it('atomically adds the fixed reward to V2 and legacy cycle quotas', async () => {
    const { service, tx, entitlements } = setup();
    const result = await service.claim(
      'user-1',
      new Date('2026-09-07T01:00:00Z'),
    );

    expect(entitlements.creditQuotaBucket).toHaveBeenCalledWith(tx, {
      bucketId: 'bucket-1',
      bytes: BigInt(config.rewardBytes),
      at: new Date('2026-09-07T01:00:00Z'),
      idempotencyKey: 'daily-check-in:user-1:2026-09-07',
      reason: '每日签到奖励',
    });
    expect(result).toMatchObject({ claimed: true, businessDate: '2026-09-07' });
  });

  it('returns the existing claim without issuing quota twice', async () => {
    const { service, tx } = setup({ existing: true });
    const result = await service.claim(
      'user-1',
      new Date('2026-09-07T04:00:00Z'),
    );
    expect(result.replayed).toBe(true);
    expect(tx.quotaBucket.update).not.toHaveBeenCalled();
    expect(tx.dailyCheckIn.create).not.toHaveBeenCalled();
  });

  it('rejects users without an active standard plan', async () => {
    const { service, tx } = setup({ eligible: false });
    await expect(
      service.claim('user-1', new Date('2026-09-07T04:00:00Z')),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.quotaBucket.update).not.toHaveBeenCalled();
  });

  it('accepts both standard and independently usable Ultra plan grants', async () => {
    const { service, tx } = setup();

    await service.getToday('user-1', new Date('2026-09-07T04:00:00Z'));

    const [request] = tx.entitlementGrant.findFirst.mock
      .calls[0] as unknown as [
      { where: { product: { series: { in: string[] } } } },
    ];
    expect(request.where.product.series.in).toEqual(['STANDARD', 'ULTRA']);
  });

  it('uses Beijing calendar dates around midnight', async () => {
    const { service, tx } = setup({ eligible: false });
    await service.getToday('user-1', new Date('2026-09-06T15:59:59Z'));
    await service.getToday('user-1', new Date('2026-09-06T16:00:00Z'));
    expect(tx.dailyCheckIn.findUnique).toHaveBeenNthCalledWith(1, {
      where: {
        userId_businessDate: {
          userId: 'user-1',
          businessDate: new Date('2026-09-06T00:00:00.000Z'),
        },
      },
    });
    expect(tx.dailyCheckIn.findUnique).toHaveBeenNthCalledWith(2, {
      where: {
        userId_businessDate: {
          userId: 'user-1',
          businessDate: new Date('2026-09-07T00:00:00.000Z'),
        },
      },
    });
  });
});
