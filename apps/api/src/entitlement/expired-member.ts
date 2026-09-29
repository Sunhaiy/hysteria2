import type { Prisma } from '@prisma/client';

/** Expiry is distinct from exhausted quota, unavailable nodes, and a suspended account. */
export function expiredMemberWhere(now = new Date()): Prisma.UserWhereInput {
  return {
    role: 'MEMBER',
    status: 'ACTIVE',
    deletedAt: null,
    entitlementGrants: {
      none: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } },
    },
    subscriptions: {
      none: {
        status: { in: ['ACTIVE', 'PAUSED'] },
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
    },
    trafficPacks: {
      none: {
        status: 'ACTIVE',
        subscriptionId: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    },
    OR: [
      {
        entitlementGrants: {
          some: {
            kind: 'PLAN',
            status: { in: ['ACTIVE', 'EXPIRED'] },
            endsAt: { lte: now },
          },
        },
      },
      {
        subscriptions: {
          some: { status: { in: ['ACTIVE', 'EXPIRED'] }, endsAt: { lte: now } },
        },
      },
    ],
  };
}
