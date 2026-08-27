import { FinanceService } from './finance.service';

describe('FinanceService', () => {
  it('separates fulfilled revenue, CDK value, refunds, and amortized cost', async () => {
    const prisma = {
      manualOrder: {
        groupBy: jest.fn().mockResolvedValue([
          {
            status: 'APPLIED',
            source: 'WALLET',
            _sum: { amountCents: 1000 },
            _count: { _all: 1 },
          },
          {
            status: 'APPLIED',
            source: 'ADMIN',
            _sum: { amountCents: 500 },
            _count: { _all: 1 },
          },
          {
            status: 'APPLIED',
            source: 'CDK',
            _sum: { amountCents: 600 },
            _count: { _all: 1 },
          },
          {
            status: 'PENDING',
            source: 'WALLET',
            _sum: { amountCents: 900 },
            _count: { _all: 1 },
          },
        ]),
      },
      refund: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 200 } }),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([
          { nodeId: 'node_1', nodeLabel: 'Node 1', amortizedCents: 1000n },
        ]),
      user: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { balanceCents: 5000 } }),
      },
      paymentRecord: {
        groupBy: jest.fn().mockResolvedValue([
          {
            source: 'WALLET',
            status: 'SETTLED',
            _sum: { amountCents: 1000 },
            _count: { _all: 1 },
          },
        ]),
      },
    };
    const service = new FinanceService(prisma as never);

    const summary = await service.summary({
      from: '2027-01-01',
      to: '2027-01-11',
    });

    const [groupBy] = prisma.manualOrder.groupBy.mock.calls[0] as unknown as [
      { where: Record<string, unknown> },
    ];
    expect(groupBy.where).toMatchObject({
      OR: [
        {
          status: 'APPLIED',
          processedAt: {
            gte: new Date('2026-12-31T16:00:00.000Z'),
            lt: new Date('2027-01-10T16:00:00.000Z'),
          },
        },
        {
          status: 'PENDING',
          createdAt: {
            gte: new Date('2026-12-31T16:00:00.000Z'),
            lt: new Date('2027-01-10T16:00:00.000Z'),
          },
        },
      ],
    });

    expect(summary).toMatchObject({
      currency: 'CNY',
      timezone: 'Asia/Shanghai',
      fulfilledNetRevenueCents: 2100,
      walletRevenueCents: 1000,
      manualRevenueCents: 500,
      cdkEntitlementValueCents: 600,
      refundCents: 200,
      amortizedNodeCostCents: 1000,
      grossProfitCents: 900,
      walletLiabilityCents: 5000,
      appliedOrders: 3,
      pendingOrders: 1,
    });
  });

  it('keeps wallet balance and ledger before/after values consistent on refund', async () => {
    const tx = {
      manualOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order_1',
          userId: 'user_1',
          status: 'APPLIED',
          amountCents: 1000,
          user: { balanceCents: 400 },
          refunds: [{ status: 'APPLIED', amountCents: 100 }],
        }),
      },
      refund: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'refund_1',
            ...data,
            method: 'WALLET',
            status: 'APPLIED',
          }),
        ),
      },
      user: { update: jest.fn().mockResolvedValue({}) },
      walletTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'wallet_refund_1' }),
      },
      walletLedgerEntry: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const referrals = {
      reverseForRefund: jest.fn().mockResolvedValue({ reversed: true }),
    };
    const service = new FinanceService(prisma as never, referrals as never);

    await service.createRefund(
      'order_1',
      { amountCents: 250, method: 'wallet', reason: 'Service adjustment' },
      'admin_1',
    );

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: { balanceCents: 650 },
    });
    const [ledgerCreate] = tx.walletLedgerEntry.create.mock
      .calls[0] as unknown as [{ data: Record<string, unknown> }];
    expect(ledgerCreate.data).toMatchObject({
      userId: 'user_1',
      actorId: 'admin_1',
      orderId: 'order_1',
      amountCents: 250,
      beforeBalanceCents: 400,
      afterBalanceCents: 650,
      kind: 'REFUND',
    });
    expect(referrals.reverseForRefund).toHaveBeenCalledWith(
      tx,
      'order_1',
      'admin_1',
      'refund_1',
    );
  });

  it('rejects refunds beyond the unrefunded order amount', async () => {
    const tx = {
      manualOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order_1',
          userId: 'user_1',
          status: 'APPLIED',
          amountCents: 1000,
          user: { balanceCents: 400 },
          refunds: [{ status: 'APPLIED', amountCents: 900 }],
        }),
      },
      refund: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new FinanceService(prisma as never);

    await expect(
      service.createRefund(
        'order_1',
        { amountCents: 101, method: 'manual', reason: 'Too much' },
        'admin_1',
      ),
    ).rejects.toThrow('Refund exceeds the refundable amount');
    expect(tx.refund.create).not.toHaveBeenCalled();
  });

  it('calculates annual break-even from Beijing-year recognized revenue', async () => {
    const prisma = {
      annualOperatingCost: {
        findUnique: jest.fn().mockResolvedValue({
          year: 2027,
          totalCostCents: 10_000,
          updatedAt: new Date('2027-02-01T00:00:00.000Z'),
          updatedBy: { email: 'admin@example.com' },
        }),
      },
      manualOrder: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { amountCents: 12_500 } }),
      },
      refund: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 500 } }),
      },
    };
    const service = new FinanceService(prisma as never);

    await expect(service.annualBreakEven(2027)).resolves.toMatchObject({
      year: 2027,
      status: 'recovered',
      annualCostCents: 10_000,
      recognizedRevenueCents: 12_500,
      refundCents: 500,
      netRevenueCents: 12_000,
      progressPercent: 100,
      differenceCents: 2_000,
      remainingCents: 0,
      profitCents: 2_000,
    });
    expect(prisma.manualOrder.aggregate).toHaveBeenCalledWith({
      where: {
        status: 'APPLIED',
        processedAt: {
          gte: new Date('2026-12-31T16:00:00.000Z'),
          lt: new Date('2027-12-31T16:00:00.000Z'),
        },
      },
      _sum: { amountCents: true },
    });
    expect(prisma.refund.aggregate).toHaveBeenCalledWith({
      where: {
        status: 'APPLIED',
        processedAt: {
          gte: new Date('2026-12-31T16:00:00.000Z'),
          lt: new Date('2027-12-31T16:00:00.000Z'),
        },
      },
      _sum: { amountCents: true },
    });
  });

  it('returns an unconfigured annual break-even result without mixing node costs', async () => {
    const prisma = {
      annualOperatingCost: { findUnique: jest.fn().mockResolvedValue(null) },
      manualOrder: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 2000 } }),
      },
      refund: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 100 } }),
      },
      nodeCost: { aggregate: jest.fn() },
    };
    const service = new FinanceService(prisma as never);

    await expect(service.annualBreakEven(2026)).resolves.toMatchObject({
      status: 'unconfigured',
      annualCostCents: null,
      netRevenueCents: 1900,
      progressPercent: null,
      differenceCents: null,
    });
    expect(prisma.nodeCost.aggregate).not.toHaveBeenCalled();
  });

  it('upserts one annual cost with the editing administrator', async () => {
    const prisma = {
      annualOperatingCost: {
        upsert: jest.fn().mockResolvedValue({
          year: 2026,
          totalCostCents: 88_000,
          updatedAt: new Date('2026-08-27T00:00:00.000Z'),
          updatedBy: { email: 'admin@example.com' },
        }),
      },
    };
    const service = new FinanceService(prisma as never);

    await service.upsertAnnualOperatingCost(
      2026,
      { totalCostCents: 88_000 },
      'admin_1',
    );

    expect(prisma.annualOperatingCost.upsert).toHaveBeenCalledWith({
      where: { year: 2026 },
      create: {
        year: 2026,
        totalCostCents: 88_000,
        updatedById: 'admin_1',
      },
      update: { totalCostCents: 88_000, updatedById: 'admin_1' },
      include: { updatedBy: { select: { email: true } } },
    });
  });
});
