import { EntitlementService } from './entitlement.service';

describe('idle traffic imports', () => {
  it('uses live depleted buckets without rewriting an existing monthly bucket', async () => {
    const grant = {
      id: 'grant',
      kind: 'PLAN',
      offer: { trafficBytes: 100n },
      quotaBuckets: [{ grantedBytes: 100n, consumedBytes: 100n }],
      product: { requiresActivePlan: false },
      accessProfile: { nodeBindings: [] },
    };
    const prisma = {
      entitlementGrant: { findMany: jest.fn().mockResolvedValue([grant]) },
      user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      quotaBucket: { upsert: jest.fn() },
    };
    const service = new EntitlementService(prisma as never);
    expect(await service.resolveAccess('user')).toMatchObject({
      allowed: false,
      reason: 'traffic_exhausted',
    });
    expect(prisma.quotaBucket.upsert).not.toHaveBeenCalled();
  });

  it('acknowledges idle batches without per-user accounting work, including replay', async () => {
    const tx = {
      usageImportBatch: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'batch' }),
        create: jest.fn().mockResolvedValue({ id: 'batch' }),
      },
      node: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          label: '[顶级]',
          server: { trafficMultiplierBasisPoints: 20000 },
        }),
      },
      user: {
        findUnique: jest
          .fn()
          .mockRejectedValue(new Error('idle traffic must not query users')),
      },
      usageRollup: { create: jest.fn() },
    };
    const service = new EntitlementService({
      $transaction: (fn: (client: typeof tx) => unknown) => fn(tx),
    } as never);
    const batch = {
      id: 'idle',
      claimedAt: '2026-09-16T00:00:00Z',
      traffic: { user1: { tx: 0, rx: 0 } },
    };
    await expect(service.applyTrafficBatch('node', batch)).resolves.toEqual({
      replayed: false,
      impactedUsers: [],
    });
    await expect(service.applyTrafficBatch('node', batch)).resolves.toEqual({
      replayed: true,
      impactedUsers: [],
    });
    expect(tx.usageImportBatch.create).toHaveBeenCalledTimes(1);
    expect(tx.user.findUnique).not.toHaveBeenCalled();
    expect(tx.usageRollup.create).not.toHaveBeenCalled();
  });
});
