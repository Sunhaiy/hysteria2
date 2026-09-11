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

function activeCalendarDays(intervals: MembershipInterval[], now: Date) {
  const normalized = intervals
    .map((interval) => ({
      startMs: interval.startsAt.getTime(),
      endMs: Math.min(interval.endsAt.getTime(), now.getTime()),
    }))
    .filter(
      (interval) =>
        Number.isFinite(interval.startMs) &&
        Number.isFinite(interval.endMs) &&
        interval.startMs < now.getTime() &&
        interval.endMs > interval.startMs,
    )
    .map((interval) => ({
      startDay: shanghaiCalendarDay(new Date(interval.startMs)),
      // Intervals are [start, end); subtracting one millisecond keeps an
      // exact midnight expiry on the preceding calendar day.
      endDay: shanghaiCalendarDay(new Date(interval.endMs - 1)),
    }))
    .sort((left, right) => left.startDay - right.startDay);

  let total = 0;
  let currentStart: number | null = null;
  let currentEnd = 0;
  for (const interval of normalized) {
    if (currentStart === null) {
      currentStart = interval.startDay;
      currentEnd = interval.endDay;
      continue;
    }
    if (interval.startDay <= currentEnd + 1) {
      currentEnd = Math.max(currentEnd, interval.endDay);
      continue;
    }
    total += currentEnd - currentStart + 1;
    currentStart = interval.startDay;
    currentEnd = interval.endDay;
  }
  if (currentStart !== null) total += currentEnd - currentStart + 1;
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
  const subscribedDays = activeCalendarDays(input.subscriptionIntervals, now);
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
