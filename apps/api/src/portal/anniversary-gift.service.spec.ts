import { AnniversaryGiftService } from './anniversary-gift.service';

describe('AnniversaryGiftService', () => {
  afterEach(() => jest.useRealTimers());

  it('offers and grants the first-anniversary gift only once', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-03T08:00:00.000Z'));
    let claimed = false;
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          createdAt: new Date('2025-08-01T08:00:00.000Z'),
        }),
      },
      subscription: {
        findMany: jest.fn().mockResolvedValue([
          {
            startsAt: new Date('2025-08-01T08:00:00.000Z'),
            endsAt: new Date('2026-09-03T08:00:00.000Z'),
          },
        ]),
      },
      entitlementGrant: { findMany: jest.fn().mockResolvedValue([]) },
      manualOrder: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve(
            claimed
              ? {
                  id: 'order_gift',
                  processedAt: new Date('2026-09-03T08:00:00.000Z'),
                }
              : null,
          ),
        ),
      },
    };
    const settings = {
      getAnniversaryGiftConfig: jest.fn().mockResolvedValue({
        enabled: true,
        configured: true,
        gift: {
          offerId: 'offer_200g',
          name: '永久 200GB 流量包',
          trafficBytes: 200 * 1024 * 1024 * 1024,
          permanent: true,
          available: true,
        },
      }),
    };
    const commerce = {
      grantAnniversaryTrafficPack: jest.fn().mockImplementation(() => {
        claimed = true;
        return Promise.resolve({ orderId: 'order_gift', replayed: false });
      }),
    };
    const service = new AnniversaryGiftService(
      prisma as never,
      settings as never,
      commerce as never,
    );

    await expect(service.getStatus('user_1')).resolves.toMatchObject({
      eligible: true,
      claimable: true,
      claimed: false,
      milestoneDays: 365,
    });
    await expect(service.claim('user_1')).resolves.toMatchObject({
      claimable: false,
      claimed: true,
      replayed: false,
      orderId: 'order_gift',
    });
    await expect(service.claim('user_1')).resolves.toMatchObject({
      claimed: true,
      replayed: true,
    });
    expect(commerce.grantAnniversaryTrafficPack).toHaveBeenCalledTimes(1);
    expect(commerce.grantAnniversaryTrafficPack).toHaveBeenCalledWith(
      'user_1',
      'offer_200g',
      'anniversary-gift:first',
    );
  });

  it('does not offer the gift before 365 complete subscribed days', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-03T08:00:00.000Z'));
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          createdAt: new Date('2025-09-04T08:00:00.000Z'),
        }),
      },
      subscription: {
        findMany: jest.fn().mockResolvedValue([
          {
            startsAt: new Date('2025-09-04T08:00:00.000Z'),
            endsAt: new Date('2026-09-03T08:00:00.000Z'),
          },
        ]),
      },
      entitlementGrant: { findMany: jest.fn().mockResolvedValue([]) },
      manualOrder: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new AnniversaryGiftService(
      prisma as never,
      {
        getAnniversaryGiftConfig: jest.fn().mockResolvedValue({
          enabled: true,
          configured: true,
          gift: { offerId: 'offer_200g' },
        }),
      } as never,
      {} as never,
    );

    await expect(service.getStatus('user_1')).resolves.toMatchObject({
      subscribedDays: 364,
      eligible: false,
      claimable: false,
    });
  });
});
