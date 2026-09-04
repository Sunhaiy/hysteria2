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

    expect(result.subscribedDays).toBe(30);
    expect(result.anniversaryRemainingDays).toBe(335);
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

    expect(result.subscribedDays).toBe(2);
  });

  it('marks the first anniversary only after 365 complete subscribed days', () => {
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
