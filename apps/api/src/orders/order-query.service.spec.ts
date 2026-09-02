import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderQueryService } from './order-query.service';

describe('OrderQueryService', () => {
  it('calculates Shanghai today and month net revenue independently', async () => {
    const orderAggregate = jest
      .fn()
      .mockResolvedValueOnce({
        _sum: { amountCents: 1_500 },
        _count: { _all: 2 },
      })
      .mockResolvedValueOnce({
        _sum: { amountCents: 8_000 },
        _count: { _all: 9 },
      });
    const refundAggregate = jest
      .fn()
      .mockResolvedValueOnce({
        _sum: { amountCents: 200 },
        _count: { _all: 1 },
      })
      .mockResolvedValueOnce({
        _sum: { amountCents: 500 },
        _count: { _all: 2 },
      });
    const service = new OrderQueryService({
      manualOrder: { aggregate: orderAggregate },
      refund: { aggregate: refundAggregate },
    } as never);

    await expect(
      service.summary(new Date('2026-09-01T16:30:00.000Z')),
    ).resolves.toMatchObject({
      today: {
        from: '2026-09-01T16:00:00.000Z',
        netRevenueCents: 1_300,
        orderCount: 2,
      },
      month: {
        from: '2026-08-31T16:00:00.000Z',
        netRevenueCents: 7_500,
        orderCount: 9,
      },
    });
    expect(orderAggregate).toHaveBeenNthCalledWith(1, {
      where: {
        status: 'APPLIED',
        source: 'PAYMENT',
        processedAt: {
          gte: new Date('2026-09-01T16:00:00.000Z'),
          lte: new Date('2026-09-01T16:30:00.000Z'),
        },
      },
      _sum: { amountCents: true },
      _count: { _all: true },
    });
    expect(refundAggregate).toHaveBeenNthCalledWith(1, {
      where: {
        status: 'APPLIED',
        processedAt: {
          gte: new Date('2026-09-01T16:00:00.000Z'),
          lte: new Date('2026-09-01T16:30:00.000Z'),
        },
        order: { source: 'PAYMENT' },
      },
      _sum: { amountCents: true },
      _count: { _all: true },
    });
  });

  it('builds paginated filters without loading orders into memory', async () => {
    const requests: unknown[] = [];
    const findMany = jest.fn((input: unknown) => {
      requests.push(input);
      return Promise.resolve([]);
    });
    const count = jest.fn().mockResolvedValue(0);
    const service = new OrderQueryService({
      manualOrder: { findMany, count },
    } as never);

    await expect(
      service.list({
        q: 'trade-1',
        source: 'payment',
        status: 'applied',
        productKind: 'plan',
        paymentType: 'wxpay',
        from: '2026-09-01',
        to: '2026-09-02',
        page: '2',
        pageSize: '20',
      }),
    ).resolves.toMatchObject({ page: 2, pageSize: 20, total: 0 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20,
        take: 20,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    const request = requests[0] as {
      where: Record<string, unknown>;
    };
    expect(request.where).toMatchObject({
      status: 'APPLIED',
      source: 'PAYMENT',
      createdAt: {
        gte: new Date('2026-08-31T16:00:00.000Z'),
        lt: new Date('2026-09-02T16:00:00.000Z'),
      },
    });
  });

  it('rejects invalid filter values and missing order details', async () => {
    const service = new OrderQueryService({
      manualOrder: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    } as never);

    await expect(service.list({ status: 'paid' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.detail('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
