import { OnlinePresenceService } from './online-presence.service';

describe('OnlinePresenceService', () => {
  afterEach(() => jest.useRealTimers());

  it('projects only known positive online accounts without storing addresses', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-24T10:00:00.000Z'));
    const tx = {
      onlinePresence: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'user_known' }]),
      },
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new OnlinePresenceService(prisma as never);

    await expect(
      service.apply('node_1', {
        user_known: 2,
        user_unknown: 1,
        user_offline: 0,
      }),
    ).resolves.toEqual({ user_known: 2 });
    expect(tx.onlinePresence.upsert).toHaveBeenCalledWith({
      where: {
        userId_nodeId: { userId: 'user_known', nodeId: 'node_1' },
      },
      create: {
        userId: 'user_known',
        nodeId: 'node_1',
        concurrentClients: 2,
        observedAt: new Date('2026-08-24T10:00:00.000Z'),
      },
      update: {
        concurrentClients: 2,
        observedAt: new Date('2026-08-24T10:00:00.000Z'),
      },
    });
    const [upsert] = tx.onlinePresence.upsert.mock.calls[0] as unknown as [
      { create: Record<string, unknown> },
    ];
    expect(upsert.create).not.toHaveProperty('ip');
  });

  it('counts connections only from the current 45-second projection', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-24T10:00:00.000Z'));
    const prisma = {
      onlinePresence: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { concurrentClients: 3 },
        }),
      },
    };
    const service = new OnlinePresenceService(prisma as never);

    await expect(service.countForUser('user_1')).resolves.toBe(3);
    expect(prisma.onlinePresence.aggregate).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        observedAt: { gte: new Date('2026-08-24T09:59:15.000Z') },
        concurrentClients: { gt: 0 },
      },
      _sum: { concurrentClients: true },
    });
  });
});
