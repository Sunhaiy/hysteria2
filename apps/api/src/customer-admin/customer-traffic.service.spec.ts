import { BadRequestException } from '@nestjs/common';
import { CustomerTrafficService } from './customer-traffic.service';

describe('CustomerTrafficService', () => {
  it('fills missing days and exposes physical, accounted, and multiplier values', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          date: '2026-08-26',
          txBytes: 100n,
          rxBytes: 300n,
          physicalBytes: 400n,
          accountedBytes: 800n,
          multiplierBasisPoints: 20_000,
          minMultiplierBasisPoints: 15_000,
          maxMultiplierBasisPoints: 25_000,
        },
      ]),
    };
    const service = new CustomerTrafficService(prisma as never);

    const result = await service.daily('user_1', {
      from: '2026-08-25',
      to: '2026-08-27',
    });

    expect(result.items).toEqual([
      {
        date: '2026-08-25',
        txBytes: 0,
        rxBytes: 0,
        physicalBytes: 0,
        accountedBytes: 0,
        actualMultiplier: null,
        minMultiplier: null,
        maxMultiplier: null,
      },
      {
        date: '2026-08-26',
        txBytes: 100,
        rxBytes: 300,
        physicalBytes: 400,
        accountedBytes: 800,
        actualMultiplier: 2,
        minMultiplier: 1.5,
        maxMultiplier: 2.5,
      },
      {
        date: '2026-08-27',
        txBytes: 0,
        rxBytes: 0,
        physicalBytes: 0,
        accountedBytes: 0,
        actualMultiplier: null,
        minMultiplier: null,
        maxMultiplier: null,
      },
    ]);
    expect(result.totals).toEqual({
      txBytes: 100,
      rxBytes: 300,
      physicalBytes: 400,
      accountedBytes: 800,
    });
  });

  it('rejects ranges longer than 366 days', async () => {
    const service = new CustomerTrafficService({} as never);

    await expect(
      service.daily('user_1', { from: '2025-01-01', to: '2026-01-02' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
