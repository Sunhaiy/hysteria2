import { CustomerAdminService } from './customer-admin.service';

describe('customer traffic detail', () => {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'member', role: 'MEMBER' }),
    },
    usageRollup: { findMany: jest.fn(), count: jest.fn().mockResolvedValue(1) },
  };
  const service = new CustomerAdminService(
    prisma as never,
    {} as never,
    {} as never,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.usageRollup.findMany.mockResolvedValue([
      {
        id: 'row',
        nodeId: 'node',
        node: { label: 'US', hostname: '192.0.2.1' },
        bucketStart: new Date('2026-09-22T04:08:57Z'),
        createdAt: new Date('2026-09-22T04:08:58Z'),
        txBytes: 10n,
        rxBytes: 90n,
        rawBytes: 100n,
        accountedBytes: 200n,
        multiplierBasisPoints: 20000,
        overageBytes: 0n,
        allocations: [],
      },
    ]);
  });
  it('filters one Beijing day and retains user scoping when sorting large charges', async () => {
    const result = await service.getCustomerTraffic('member', {
      date: '2026-09-22',
      sort: 'largest',
      page: '2',
      pageSize: '20',
    });
    expect(prisma.usageRollup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'member',
          bucketStart: {
            gte: new Date('2026-09-21T16:00:00Z'),
            lt: new Date('2026-09-22T16:00:00Z'),
          },
        },
        skip: 20,
        take: 20,
        orderBy: [
          { accountedBytes: { sort: 'desc', nulls: 'last' } },
          { bucketStart: 'desc' },
          { id: 'desc' },
        ],
      }),
    );
    expect(result.items[0]).toMatchObject({
      physicalBytes: 100,
      accountedBytes: 200,
      txBytes: 10,
      rxBytes: 90,
      multiplier: 2,
      nodeAddress: '192.0.2.1',
    });
  });
  it('retains legacy pagination and does not invent a historical multiplier', async () => {
    prisma.usageRollup.findMany.mockResolvedValueOnce([
      {
        id: 'legacy',
        nodeId: 'node',
        node: { label: 'US', hostname: '192.0.2.1' },
        bucketStart: new Date('2026-09-22T04:08:57Z'),
        txBytes: 10n,
        rxBytes: 90n,
        accountedBytes: null,
        multiplierBasisPoints: null,
        overageBytes: 0n,
        allocations: [],
      },
    ]);
    const result = await service.getCustomerTraffic('member', {});
    expect(prisma.usageRollup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'member' },
        orderBy: [{ bucketStart: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(result.items[0]).toMatchObject({
      physicalBytes: 100,
      accountedBytes: 100,
      multiplier: null,
    });
  });
  it('rejects unsupported sorting before reading traffic', async () => {
    await expect(
      service.getCustomerTraffic('member', { sort: 'invalid' }),
    ).rejects.toThrow('排序');
    expect(prisma.usageRollup.findMany).not.toHaveBeenCalled();
  });
  it.each(['2026-02-30', 'invalid'])(
    'rejects invalid dates: %s',
    async (date) => {
      await expect(
        service.getCustomerTraffic('member', { date }),
      ).rejects.toThrow('日期');
      expect(prisma.usageRollup.findMany).not.toHaveBeenCalled();
    },
  );
});
