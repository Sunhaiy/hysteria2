import { ControlPlaneStoreService } from './control-plane.store';

describe('ControlPlaneStoreService wallet compatibility ledger', () => {
  it('records an immutable ledger entry for an absolute admin adjustment', async () => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          balanceCents: 3000,
          deletedAt: null,
        }),
        update: jest
          .fn()
          .mockResolvedValueOnce({ balanceCents: 3000, deletedAt: null })
          .mockResolvedValueOnce({ balanceCents: 4200 }),
      },
      walletTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'legacy-adjust-1' }),
      },
      walletLedgerEntry: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'ledger-adjust-1' }),
      },
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          balanceCents: 3000,
        }),
      },
      walletTransaction: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new ControlPlaneStoreService(prisma as never, {} as never);

    await service.adjustUserBalance('user-1', 4200, '兼容后台调整');

    expect(tx.walletLedgerEntry.create).toHaveBeenCalledWith({
      data: {
        legacyTransactionId: 'legacy-adjust-1',
        userId: 'user-1',
        amountCents: 1200,
        beforeBalanceCents: 3000,
        afterBalanceCents: 4200,
        kind: 'ADJUST',
        note: '兼容后台调整',
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('records a balance redemption code in both wallet ledgers', async () => {
    const now = new Date('2026-09-07T08:00:00.000Z');
    const code = {
      id: 'balance-code-1',
      code: 'BALANCE500',
      label: '余额 5 元',
      kind: 'BALANCE',
      status: 'ACTIVE',
      planId: null,
      plan: null,
      catalogOfferId: null,
      catalogOffer: null,
      trafficPackProductId: null,
      trafficPackProduct: null,
      trafficBytes: null,
      amountCents: 500,
      discountPercent: null,
      discountCents: null,
      planMode: 'RENEW',
      maxUses: 1,
      usedCount: 0,
      note: null,
      expiresAt: null,
      createdById: 'admin-1',
      createdBy: null,
      redeemedById: null,
      redeemedBy: null,
      redeemedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const tx = {
      redemptionCode: {
        findUnique: jest.fn().mockResolvedValue(code),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({
          ...code,
          status: 'REDEEMED',
          usedCount: 1,
          redeemedById: 'user-1',
          redeemedAt: now,
        }),
      },
      redemptionUse: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      subscription: { findFirst: jest.fn().mockResolvedValue(null) },
      user: {
        update: jest
          .fn()
          .mockResolvedValueOnce({ balanceCents: 2000, deletedAt: null })
          .mockResolvedValueOnce({ balanceCents: 2500 }),
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', balanceCents: 2500 }),
      },
      walletTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'legacy-topup-1' }),
      },
      walletLedgerEntry: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'ledger-topup-1' }),
      },
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          balanceCents: 2000,
          deletedAt: null,
        }),
      },
      subscription: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      trafficPack: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      redemptionCode: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(code),
      },
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new ControlPlaneStoreService(prisma as never, {} as never);

    await service.redeemRedemptionCode('user-1', code.code);

    expect(tx.walletLedgerEntry.create).toHaveBeenCalledWith({
      data: {
        legacyTransactionId: 'legacy-topup-1',
        userId: 'user-1',
        amountCents: 500,
        beforeBalanceCents: 2000,
        afterBalanceCents: 2500,
        kind: 'TOPUP',
        idempotencyKey: 'redemption:balance-code-1',
        note: '兑换码充值 BALANCE500',
      },
    });
  });
});
