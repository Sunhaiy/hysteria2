import { BadRequestException } from '@nestjs/common';
import { TrafficPackStatus } from '@prisma/client';
import { ControlPlaneStoreService } from './control-plane.store';

describe('ControlPlaneStoreService traffic pack purchases', () => {
  const purchasedAt = new Date('2026-08-14T00:00:00.000Z');
  const subscriptionEndsAt = new Date('2026-08-20T00:00:00.000Z');

  afterEach(() => jest.useRealTimers());

  function createFixture(debitCount = 1) {
    const tx = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user_1', balanceCents: 5000 }),
        updateMany: jest.fn().mockResolvedValue({ count: debitCount }),
      },
      trafficPackProduct: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pack_100g',
          name: '100 GB 加油包',
          active: true,
          archivedAt: null,
          trafficBytes: BigInt(100 * 1024 * 1024 * 1024),
          validityDays: 30,
          priceCents: 1000,
          accessProfileId: 'profile_core',
          accessProfile: {
            active: true,
            nodeBindings: [{ nodeId: 'node_1' }],
          },
        }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'subscription_1',
          userId: 'user_1',
          endsAt: subscriptionEndsAt,
        }),
      },
      walletTransaction: { create: jest.fn().mockResolvedValue({}) },
      manualOrder: { create: jest.fn().mockResolvedValue({ id: 'order_1' }) },
      accessAccount: {
        upsert: jest.fn().mockResolvedValue({ id: 'account_1' }),
      },
      trafficPack: { create: jest.fn().mockResolvedValue({}) },
      redemptionCode: { findUnique: jest.fn(), update: jest.fn() },
      redemptionUse: { create: jest.fn() },
    };
    const prisma = {
      subscription: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    };
    const service = new ControlPlaneStoreService(prisma as never);
    jest
      .spyOn(service, 'getPortalOverview')
      .mockResolvedValue({ purchasedAt } as never);

    return { service, prisma, tx };
  }

  it('caps a product validity period at the active subscription expiry', async () => {
    jest.useFakeTimers().setSystemTime(purchasedAt);
    const { service, tx } = createFixture();

    await service.purchaseTrafficPackWithBalance('user_1', 'pack_100g');

    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user_1', balanceCents: { gte: 1000 } },
      data: { balanceCents: { decrement: 1000 } },
    });
    expect(tx.trafficPack.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        subscriptionId: 'subscription_1',
        accessAccountId: 'account_1',
        trafficPackProductId: 'pack_100g',
        accessProfileId: 'profile_core',
        label: '100 GB 加油包',
        totalBytes: BigInt(100 * 1024 * 1024 * 1024),
        remainingBytes: BigInt(100 * 1024 * 1024 * 1024),
        status: TrafficPackStatus.ACTIVE,
        expiresAt: subscriptionEndsAt,
      },
    });
  });

  it('rolls back before creating an order when the balance debit fails', async () => {
    const { service, tx } = createFixture(0);

    await expect(
      service.purchaseTrafficPackWithBalance('user_1', 'pack_100g'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    expect(tx.manualOrder.create).not.toHaveBeenCalled();
    expect(tx.trafficPack.create).not.toHaveBeenCalled();
  });
});
