import { FinanceService } from './finance.service';

describe('FinanceService', () => {
  it('separates fulfilled revenue, CDK value, refunds, and amortized cost', async () => {
    const prisma = {
      manualOrder: {
        findMany: jest.fn().mockResolvedValue([
          { status: 'APPLIED', source: 'WALLET', amountCents: 1000 },
          { status: 'APPLIED', source: 'ADMIN', amountCents: 500 },
          { status: 'APPLIED', source: 'CDK', amountCents: 600 },
          { status: 'PENDING', source: 'WALLET', amountCents: 900 },
        ]),
      },
      refund: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 200 }]),
      },
      nodeCost: {
        findMany: jest.fn().mockResolvedValue([
          {
            nodeId: 'node_1',
            node: { label: 'Node 1' },
            amountCents: 3100,
            effectiveFrom: new Date('2026-12-31T16:00:00.000Z'),
            effectiveTo: new Date('2027-01-31T16:00:00.000Z'),
          },
        ]),
      },
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

    expect(summary).toMatchObject({
      currency: 'CNY',
      timezone: 'Asia/Shanghai',
      fulfilledNetRevenueCents: 1500,
      walletRevenueCents: 1000,
      manualRevenueCents: 500,
      cdkEntitlementValueCents: 600,
      refundCents: 200,
      amortizedNodeCostCents: 1000,
      grossProfitCents: 300,
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
    const service = new FinanceService(prisma as never);

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
});
