import type { Prisma } from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const FIRST_ANNIVERSARY_DAYS = 365;

export type MembershipInterval = {
  startsAt: Date;
  endsAt: Date;
};

function shanghaiCalendarDay(value: Date) {
  return Math.floor((value.getTime() + SHANGHAI_OFFSET_MS) / DAY_MS);
}

function activeDurationMs(intervals: MembershipInterval[], now: Date) {
  const normalized = intervals
    .map((interval) => ({
      start: interval.startsAt.getTime(),
      end: Math.min(interval.endsAt.getTime(), now.getTime()),
    }))
    .filter(
      (interval) =>
        Number.isFinite(interval.start) &&
        Number.isFinite(interval.end) &&
        interval.start < now.getTime() &&
        interval.end > interval.start,
    )
    .sort((left, right) => left.start - right.start);

  let total = 0;
  let currentStart: number | null = null;
  let currentEnd = 0;
  for (const interval of normalized) {
    if (currentStart === null) {
      currentStart = interval.start;
      currentEnd = interval.end;
      continue;
    }
    if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
      continue;
    }
    total += currentEnd - currentStart;
    currentStart = interval.start;
    currentEnd = interval.end;
  }
  if (currentStart !== null) total += currentEnd - currentStart;
  return total;
}

export function calculateMembershipJourney(input: {
  registeredAt: Date;
  subscriptionIntervals: MembershipInterval[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const companionshipDays = Math.max(
    1,
    shanghaiCalendarDay(now) - shanghaiCalendarDay(input.registeredAt) + 1,
  );
  const subscribedDays = Math.floor(
    activeDurationMs(input.subscriptionIntervals, now) / DAY_MS,
  );
  const anniversaryProgressPercent = Math.min(
    100,
    Math.round((subscribedDays / FIRST_ANNIVERSARY_DAYS) * 1000) / 10,
  );

  return {
    companionshipDays,
    subscribedDays,
    anniversaryTargetDays: FIRST_ANNIVERSARY_DAYS,
    anniversaryRemainingDays: Math.max(
      0,
      FIRST_ANNIVERSARY_DAYS - subscribedDays,
    ),
    anniversaryProgressPercent,
    anniversaryEligible: subscribedDays >= FIRST_ANNIVERSARY_DAYS,
  };
}

export async function calculateMembershipJourneyForUser(
  source: Pick<Prisma.TransactionClient, 'subscription' | 'entitlementGrant'>,
  input: {
    userId: string;
    registeredAt: Date;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const [subscriptions, grants] = await Promise.all([
    source.subscription.findMany({
      where: {
        userId: input.userId,
        status: { in: ['ACTIVE', 'EXPIRED', 'CANCELED'] },
        startsAt: { lt: now },
      },
      select: { startsAt: true, endsAt: true },
    }),
    source.entitlementGrant.findMany({
      where: {
        userId: input.userId,
        kind: 'PLAN',
        startsAt: { lt: now },
      },
      select: { startsAt: true, endsAt: true },
    }),
  ]);

  return calculateMembershipJourney({
    registeredAt: input.registeredAt,
    subscriptionIntervals: [...subscriptions, ...grants],
    now,
  });
}
