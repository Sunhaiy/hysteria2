const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  applyCandidate,
  calculateShortfall,
  findCandidates,
} = require('./reconcile-traffic-pack-multipliers');

describe('traffic-pack multiplier reconciliation', () => {
  it('calculates the confirmed production undercharge without changing history', () => {
    const physicalBytes = 20_538_376n;
    assert.equal(calculateShortfall(physicalBytes, 21_000), 22_592_213n);
    assert.equal(
      physicalBytes + calculateShortfall(physicalBytes, 21_000),
      43_130_589n,
    );
  });

  it('does not compensate one-times or zero usage', () => {
    assert.equal(calculateShortfall(100n, 10_000), 0n);
    assert.equal(calculateShortfall(0n, 21_000), 0n);
  });

  it('limits candidate usage to the reviewed deployment cutoff', async () => {
    const cutoff = new Date('2026-09-02T10:30:00.000Z');
    let query;
    const prisma = {
      entitlementGrant: {
        findMany: async (input) => {
          query = input;
          return [];
        },
      },
    };

    assert.deepEqual(await findCandidates(prisma, cutoff), []);
    assert.deepEqual(
      query.select.quotaBuckets.select.allocations.where.usageRollup.createdAt,
      { lt: cutoff },
    );
  });

  it('requires an exact applied order snapshot before proposing recovery', async () => {
    const startsAt = new Date('2026-09-01T08:00:00.000Z');
    const prisma = {
      entitlementGrant: {
        findMany: async () => [
          {
            id: 'grant_1',
            offerId: 'offer_1',
            startsAt,
            user: { id: 'user_1', email: 'member@example.com' },
            accessAccountId: 'account_1',
            legacyTrafficPackId: null,
            quotaBuckets: [
              {
                id: 'bucket_1',
                grantedBytes: 1_000n,
                consumedBytes: 100n,
                trafficMultiplierBasisPointsSnapshot: 21_000,
                adjustments: [],
                allocations: [{ accountedBytes: 100n }],
              },
            ],
          },
        ],
      },
      manualOrder: {
        findMany: async () => [
          {
            id: 'order_1',
            userId: 'user_1',
            catalogOfferId: 'offer_1',
            processedAt: startsAt,
            createdAt: startsAt,
            trafficMultiplierBasisPointsSnapshot: 21_000,
          },
        ],
      },
    };

    const candidates = await findCandidates(
      prisma,
      new Date('2026-09-02T10:30:00.000Z'),
    );

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].confirmedOrderId, 'order_1');
    assert.equal(candidates[0].requestedBytes, 110n);
    assert.equal(candidates[0].appliedBytes, 110n);
  });

  it('writes one bounded quota adjustment without rewriting usage', async () => {
    const calls = [];
    const tx = {
      quotaAdjustment: {
        findUnique: async () => null,
        create: async (input) => {
          calls.push(['adjustment', input]);
          return { id: 'adjustment_1' };
        },
      },
      quotaBucket: {
        findUniqueOrThrow: async () => ({
          id: 'bucket_1',
          grantedBytes: 120n,
          consumedBytes: 100n,
        }),
        update: async (input) => calls.push(['bucket', input]),
      },
      trafficPack: { findUnique: async () => null },
      auditLog: {
        create: async (input) => calls.push(['audit', input]),
      },
    };
    const prisma = { $transaction: async (operation) => operation(tx) };
    const candidate = {
      idempotencyKey: 'traffic-pack-multiplier-v1:bucket_1',
      confirmedOrderId: 'order_1',
      grantId: 'grant_1',
      bucketId: 'bucket_1',
      userId: 'user_1',
      accessAccountId: 'account_1',
      legacyTrafficPackId: null,
      targetBasisPoints: 21_000,
      accountedAtOneX: 100n,
      requestedBytes: 110n,
    };

    const result = await applyCandidate(prisma, candidate);

    assert.deepEqual(result, {
      status: 'applied',
      adjustmentId: 'adjustment_1',
      appliedBytes: 20n,
    });
    assert.deepEqual(calls[0], [
      'bucket',
      { where: { id: 'bucket_1' }, data: { grantedBytes: 100n } },
    ]);
    assert.equal(calls[1][1].data.deltaBytes, -20n);
    assert.equal(calls[1][1].data.afterRemainingBytes, 0n);
    assert.equal(calls[2][1].data.metadata.unrecoveredBytes, '90');
  });

  it('replays an existing compensation idempotently', async () => {
    const prisma = {
      $transaction: async (operation) =>
        operation({
          quotaAdjustment: {
            findUnique: async () => ({ id: 'adjustment_existing' }),
          },
        }),
    };

    assert.deepEqual(
      await applyCandidate(prisma, {
        idempotencyKey: 'traffic-pack-multiplier-v1:bucket_1',
      }),
      { status: 'replayed', adjustmentId: 'adjustment_existing' },
    );
  });
});
