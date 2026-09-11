import { calculateMembershipJourney } from './portal-membership';

describe('portal membership journey', () => {
  const now = new Date('2026-09-03T04:00:00.000Z');

  it('counts companionship by Shanghai calendar day including registration day', () => {
    const result = calculateMembershipJourney({
      registeredAt: new Date('2026-09-01T15:59:00.000Z'),
      subscriptionIntervals: [],
      now,
    });

    expect(result.companionshipDays).toBe(3);
    expect(result.subscribedDays).toBe(0);
  });

  it('merges overlapping subscription intervals before counting active days', () => {
    const result = calculateMembershipJourney({
      registeredAt: new Date('2026-01-01T00:00:00.000Z'),
      subscriptionIntervals: [
        {
          startsAt: new Date('2026-08-01T00:00:00.000Z'),
          endsAt: new Date('2026-08-21T00:00:00.000Z'),
        },
        {
          startsAt: new Date('2026-08-11T00:00:00.000Z'),
          endsAt: new Date('2026-08-31T00:00:00.000Z'),
        },
      ],
      now,
    });

    expect(result.subscribedDays).toBe(31);
    expect(result.anniversaryRemainingDays).toBe(334);
  });

  it('caps active subscriptions at the current time', () => {
    const result = calculateMembershipJourney({
      registeredAt: new Date('2025-01-01T00:00:00.000Z'),
      subscriptionIntervals: [
        {
          startsAt: new Date('2026-09-01T04:00:00.000Z'),
          endsAt: new Date('9999-12-31T23:59:59.000Z'),
        },
      ],
      now,
    });

    expect(result.subscribedDays).toBe(3);
  });

  it('counts every Shanghai calendar day touched by an active subscription', () => {
    const result = calculateMembershipJourney({
      registeredAt: new Date('2026-09-09T15:11:00.000Z'),
      subscriptionIntervals: [
        {
          startsAt: new Date('2026-09-09T15:11:00.000Z'),
          endsAt: new Date('2026-10-09T15:11:00.000Z'),
        },
      ],
      now: new Date('2026-09-11T05:00:00.000Z'),
    });

    expect(result.subscribedDays).toBe(3);
  });

  it('does not count the next Shanghai day when a subscription expires at midnight', () => {
    const result = calculateMembershipJourney({
      registeredAt: new Date('2026-09-08T16:00:00.000Z'),
      subscriptionIntervals: [
        {
          startsAt: new Date('2026-09-08T16:00:00.000Z'),
          endsAt: new Date('2026-09-10T16:00:00.000Z'),
        },
      ],
      now: new Date('2026-09-11T05:00:00.000Z'),
    });

    expect(result.subscribedDays).toBe(2);
  });

  it('merges multiple active intervals on the same day without double counting', () => {
    const result = calculateMembershipJourney({
      registeredAt: new Date('2026-09-09T00:00:00.000Z'),
      subscriptionIntervals: [
        {
          startsAt: new Date('2026-09-09T00:00:00.000Z'),
          endsAt: new Date('2026-09-09T03:00:00.000Z'),
        },
        {
          startsAt: new Date('2026-09-09T08:00:00.000Z'),
          endsAt: new Date('2026-09-09T12:00:00.000Z'),
        },
      ],
      now: new Date('2026-09-11T05:00:00.000Z'),
    });

    expect(result.subscribedDays).toBe(1);
  });

  it('keeps unsubscribed Shanghai calendar days out of the total', () => {
    const result = calculateMembershipJourney({
      registeredAt: new Date('2026-09-08T00:00:00.000Z'),
      subscriptionIntervals: [
        {
          startsAt: new Date('2026-09-08T00:00:00.000Z'),
          endsAt: new Date('2026-09-08T08:00:00.000Z'),
        },
        {
          startsAt: new Date('2026-09-10T00:00:00.000Z'),
          endsAt: new Date('2026-09-10T08:00:00.000Z'),
        },
      ],
      now: new Date('2026-09-11T05:00:00.000Z'),
    });

    expect(result.subscribedDays).toBe(2);
  });

  it('marks the first anniversary after 365 subscribed calendar days', () => {
    const result = calculateMembershipJourney({
      registeredAt: new Date('2025-01-01T00:00:00.000Z'),
      subscriptionIntervals: [
        {
          startsAt: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
          endsAt: new Date('9999-12-31T23:59:59.000Z'),
        },
      ],
      now,
    });

    expect(result.anniversaryEligible).toBe(true);
    expect(result.anniversaryProgressPercent).toBe(100);
    expect(result.anniversaryRemainingDays).toBe(0);
  });
});
