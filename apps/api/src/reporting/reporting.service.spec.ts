import { OrderKind, OrderSource, OrderStatus } from '@prisma/client';
import { ReportingService } from './reporting.service';

describe('ReportingService', () => {
  const prisma = {
    manualOrder: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
    node: { findMany: jest.fn() },
    usageImportBatch: { count: jest.fn() },
  };

  beforeEach(() => jest.clearAllMocks());

  it('summarizes wallet revenue and CDK entitlement value without inventing payment metrics', async () => {
    prisma.manualOrder.groupBy.mockResolvedValue([
      {
        source: OrderSource.WALLET,
        kind: OrderKind.RENEWAL,
        status: OrderStatus.APPLIED,
        _count: { _all: 2 },
        _sum: { amountCents: 3600, basePriceCents: 4000, discountCents: 400 },
      },
      {
        source: OrderSource.CDK,
        kind: OrderKind.TRAFFIC_PACK,
        status: OrderStatus.APPLIED,
        _count: { _all: 1 },
        _sum: { amountCents: 900, basePriceCents: 900, discountCents: 0 },
      },
      {
        source: OrderSource.ADMIN,
        kind: OrderKind.RENEWAL,
        status: OrderStatus.PENDING,
        _count: { _all: 1 },
        _sum: { amountCents: 1800, basePriceCents: null, discountCents: 0 },
      },
    ]);
    prisma.node.findMany.mockResolvedValue([
      {
        active: true,
        lastSyncAt: new Date('2026-08-22T00:09:30.000Z'),
        lastSyncError: null,
      },
      { active: true, lastSyncAt: null, lastSyncError: 'timeout' },
    ]);
    prisma.usageImportBatch.count.mockResolvedValue(2);
    const service = new ReportingService(prisma as never);

    const summary = await service.getCommerceSummary(
      new Date('2026-08-22T00:10:00.000Z'),
    );

    expect(summary.commerce).toMatchObject({
      walletRevenueCents: 3600,
      cdkEntitlementValueCents: 900,
      appliedOrders: 3,
      pendingOrders: 1,
      completionRatePercent: 75,
      discountCents: 400,
      refunds: { available: false },
      payments: { available: false },
    });
    expect(summary.nodes).toMatchObject({
      active: 2,
      healthy: 1,
      error: 1,
      availabilityPercent: 50,
      maxSyncDelaySeconds: 30,
      pendingUsageBatches: 2,
    });
  });

  it('exports an RFC 4180 compatible UTF-8 CSV', async () => {
    prisma.manualOrder.findMany.mockResolvedValue([
      {
        id: 'order_1',
        createdAt: new Date('2026-08-22T01:02:03.000Z'),
        processedAt: null,
        status: OrderStatus.PENDING,
        kind: OrderKind.RENEWAL,
        source: OrderSource.ADMIN,
        amountCents: 1800,
        basePriceCents: 2000,
        discountCents: 200,
        currency: 'CNY',
        productSlugSnapshot: 'starter',
        productNameSnapshot: 'Starter, "Plus"',
        durationDays: 30,
        validityDays: null,
        trafficBytes: BigInt(1024),
        entitlementExpiresAt: null,
        idempotencyKey: null,
        note: 'first line\nsecond line',
        user: { email: 'member@example.com', displayName: 'Member' },
        processedBy: null,
      },
    ]);
    const service = new ReportingService(prisma as never);

    const csv = await service.exportOrdersCsv();

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Starter, ""Plus"""');
    expect(csv).toContain('"first line\nsecond line"');
  });
});
