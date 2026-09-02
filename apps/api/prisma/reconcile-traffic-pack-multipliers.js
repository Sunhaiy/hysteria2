const path = require('node:path');
const { Prisma, PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const scale = 10_000n;
const reconciliationVersion = 'traffic-pack-multiplier-v1';

function calculateShortfall(accountedAtOneX, targetBasisPoints) {
  if (targetBasisPoints <= 10_000 || accountedAtOneX <= 0n) return 0n;
  return (
    (accountedAtOneX * BigInt(targetBasisPoints)) / scale - accountedAtOneX
  );
}

function stringify(value) {
  return JSON.stringify(
    value,
    (_key, item) => (typeof item === 'bigint' ? item.toString() : item),
    2,
  );
}

async function findCandidates(prisma, cutoff) {
  const grants = await prisma.entitlementGrant.findMany({
    where: {
      kind: 'TRAFFIC_PACK',
      status: 'ACTIVE',
      endsAt: { gt: new Date() },
    },
    select: {
      id: true,
      offerId: true,
      startsAt: true,
      user: { select: { id: true, email: true } },
      accessAccountId: true,
      legacyTrafficPackId: true,
      quotaBuckets: {
        select: {
          id: true,
          grantedBytes: true,
          consumedBytes: true,
          trafficMultiplierBasisPointsSnapshot: true,
          adjustments: {
            where: {
              idempotencyKey: { startsWith: reconciliationVersion },
            },
            select: { idempotencyKey: true },
          },
          allocations: {
            where: {
              usageRollup: {
                multiplierBasisPoints: 10_000,
                createdAt: { lt: cutoff },
              },
            },
            select: { accountedBytes: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (grants.length === 0) return [];

  const orders = await prisma.manualOrder.findMany({
    where: {
      userId: { in: [...new Set(grants.map((grant) => grant.user.id))] },
      kind: 'TRAFFIC_PACK',
      status: 'APPLIED',
      trafficMultiplierBasisPointsSnapshot: { not: null },
    },
    select: {
      id: true,
      userId: true,
      catalogOfferId: true,
      processedAt: true,
      createdAt: true,
      trafficMultiplierBasisPointsSnapshot: true,
    },
  });

  return grants.flatMap((grant) =>
    grant.quotaBuckets.flatMap((bucket) => {
      const idempotencyKey = `${reconciliationVersion}:${bucket.id}`;
      if (
        bucket.adjustments.some(
          (adjustment) => adjustment.idempotencyKey === idempotencyKey,
        )
      ) {
        return [];
      }
      const matchingOrder = orders.find(
        (order) =>
          order.userId === grant.user.id &&
          order.catalogOfferId === grant.offerId &&
          (order.processedAt ?? order.createdAt).getTime() ===
            grant.startsAt.getTime() &&
          order.trafficMultiplierBasisPointsSnapshot ===
            bucket.trafficMultiplierBasisPointsSnapshot,
      );
      if (!matchingOrder) return [];
      const accountedAtOneX = bucket.allocations.reduce(
        (total, allocation) => total + allocation.accountedBytes,
        0n,
      );
      const requestedBytes = calculateShortfall(
        accountedAtOneX,
        bucket.trafficMultiplierBasisPointsSnapshot,
      );
      if (requestedBytes <= 0n) return [];
      const availableBytes =
        bucket.grantedBytes > bucket.consumedBytes
          ? bucket.grantedBytes - bucket.consumedBytes
          : 0n;
      return [
        {
          idempotencyKey,
          confirmedOrderId: matchingOrder.id,
          grantId: grant.id,
          bucketId: bucket.id,
          userId: grant.user.id,
          email: grant.user.email,
          accessAccountId: grant.accessAccountId,
          legacyTrafficPackId: grant.legacyTrafficPackId,
          targetBasisPoints: bucket.trafficMultiplierBasisPointsSnapshot,
          accountedAtOneX,
          requestedBytes,
          availableBytes,
          appliedBytes:
            requestedBytes < availableBytes ? requestedBytes : availableBytes,
          unrecoveredBytes:
            requestedBytes > availableBytes
              ? requestedBytes - availableBytes
              : 0n,
        },
      ];
    }),
  );
}

async function applyCandidate(prisma, candidate) {
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.quotaAdjustment.findUnique({
        where: { idempotencyKey: candidate.idempotencyKey },
      });
      if (existing) return { status: 'replayed', adjustmentId: existing.id };

      const bucket = await tx.quotaBucket.findUniqueOrThrow({
        where: { id: candidate.bucketId },
      });
      const beforeRemainingBytes =
        bucket.grantedBytes > bucket.consumedBytes
          ? bucket.grantedBytes - bucket.consumedBytes
          : 0n;
      const appliedBytes =
        candidate.requestedBytes < beforeRemainingBytes
          ? candidate.requestedBytes
          : beforeRemainingBytes;
      const afterRemainingBytes = beforeRemainingBytes - appliedBytes;

      if (appliedBytes > 0n) {
        await tx.quotaBucket.update({
          where: { id: bucket.id },
          data: { grantedBytes: bucket.grantedBytes - appliedBytes },
        });
      }
      const adjustment = await tx.quotaAdjustment.create({
        data: {
          accessAccountId: candidate.accessAccountId,
          quotaBucketId: bucket.id,
          idempotencyKey: candidate.idempotencyKey,
          mode: 'DELTA',
          deltaBytes: -appliedBytes,
          beforeRemainingBytes,
          afterRemainingBytes,
          reason: 'Recover historical traffic-pack multiplier undercharge',
        },
      });

      if (candidate.legacyTrafficPackId) {
        const pack = await tx.trafficPack.findUnique({
          where: { id: candidate.legacyTrafficPackId },
        });
        if (pack) {
          const remainingBytes =
            pack.remainingBytes > appliedBytes
              ? pack.remainingBytes - appliedBytes
              : 0n;
          await tx.trafficPack.update({
            where: { id: pack.id },
            data: {
              remainingBytes,
              status: remainingBytes === 0n ? 'EXHAUSTED' : pack.status,
            },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          action: 'TRAFFIC_MULTIPLIER_UNDERCHARGE_RECONCILED',
          targetType: 'QuotaBucket',
          targetId: bucket.id,
          metadata: {
            userId: candidate.userId,
            grantId: candidate.grantId,
            confirmedOrderId: candidate.confirmedOrderId,
            targetBasisPoints: candidate.targetBasisPoints,
            accountedAtOneX: candidate.accountedAtOneX.toString(),
            requestedBytes: candidate.requestedBytes.toString(),
            appliedBytes: appliedBytes.toString(),
            unrecoveredBytes: (
              candidate.requestedBytes - appliedBytes
            ).toString(),
            idempotencyKey: candidate.idempotencyKey,
          },
        },
      });
      return { status: 'applied', adjustmentId: adjustment.id, appliedBytes };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const cutoffArgument = process.argv.find((value) =>
      value.startsWith('--cutoff='),
    );
    const cutoff = new Date(cutoffArgument?.slice('--cutoff='.length) ?? '');
    if (Number.isNaN(cutoff.getTime())) {
      throw new Error(
        'Pass the multiplier-fix deployment time as --cutoff=<ISO timestamp>',
      );
    }
    const candidates = await findCandidates(prisma, cutoff);
    console.log(
      stringify({
        mode: process.argv.includes('--apply') ? 'apply' : 'dry-run',
        cutoff: cutoff.toISOString(),
        candidates,
      }),
    );
    if (!process.argv.includes('--apply')) return;
    if (
      process.env.TRAFFIC_MULTIPLIER_RECONCILE_CONFIRM !==
      'apply-reviewed-undercharges'
    ) {
      throw new Error(
        'Set TRAFFIC_MULTIPLIER_RECONCILE_CONFIRM=apply-reviewed-undercharges after reviewing the dry run',
      );
    }
    for (const candidate of candidates) {
      console.log(stringify(await applyCandidate(prisma, candidate)));
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { applyCandidate, calculateShortfall, findCandidates };
