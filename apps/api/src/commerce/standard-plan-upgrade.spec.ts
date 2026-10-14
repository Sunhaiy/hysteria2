import { StandardPlanUpgrade, remainingValue } from './standard-plan-upgrade';
import { SecretCipherService } from '../security/secret-cipher.service';
import { EntitlementService } from '../entitlement/entitlement.service';

function fixture(
  months = 12,
  start = '2026-01-01T00:00:00Z',
  end = '2027-01-01T00:00:00Z',
) {
  const startsAt = new Date(start),
    endsAt = new Date(end);
  const offer = {
    id: 'target',
    slug: 'plus-year',
    name: '年付',
    billingPeriod:
      months === 12 ? 'YEARLY' : months === 3 ? 'QUARTERLY' : 'MONTHLY',
    intervalMonths: months,
    priceCents: 24000,
    trafficBytes: 250n,
    active: true,
    archivedAt: null,
    currency: 'CNY',
    legacyPlanOfferId: 'legacy-target',
    product: {
      id: 'plus',
      slug: 'plus',
      name: 'Plus',
      kind: 'PLAN',
      series: 'STANDARD',
      status: 'ACTIVE',
      quotaCadence: 'MONTHLY_RESET',
      legacyPlanId: 'plus-plan',
      accessProfileId: 'plus-profile',
      accessProfile: { speedUpMbps: 100, speedDownMbps: 100, deviceLimit: 5 },
    },
  };
  const order = {
    id: 'original',
    source: 'PAYMENT',
    status: 'APPLIED',
    amountCents: 10000,
    intervalMonthsSnapshot: months,
    processedAt: startsAt,
    createdAt: startsAt,
    entitlementExpiresAt: endsAt,
    refunds: [],
    epayPaymentAttempt: null,
    note: 'PLAN_ACTIVATION:initial',
  };
  const grant = {
    id: 'grant',
    userId: 'user',
    productId: 'boost',
    offerId: 'old',
    legacySubscriptionId: 'subscription',
    startsAt,
    endsAt,
    resetAnchorAt: startsAt,
    status: 'ACTIVE',
    quotaCadenceSnapshot: 'MONTHLY_RESET',
    trafficBytesSnapshot: 150n,
    product: { name: 'Boost' },
    offer: { ...offer, id: 'old', priceCents: 15000 },
    speedUpMbpsSnapshot: 100,
    speedDownMbpsSnapshot: 100,
    deviceLimitSnapshot: 5,
    quotaBuckets: [
      {
        id: 'bucket',
        startsAt,
        endsAt,
        grantedBytes: 170n,
        consumedBytes: 80n,
      },
    ],
    orders: [order],
  };
  const tx = {
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ status: 'ACTIVE', deletedAt: null }),
    },
    entitlementGrant: { findMany: jest.fn().mockResolvedValue([grant]) },
    subscription: { findFirst: jest.fn().mockResolvedValue(null) },
    groupBuyMember: { findUnique: jest.fn().mockResolvedValue(null) },
    catalogOffer: { findUnique: jest.fn().mockResolvedValue(offer) },
  };
  const oldKey = process.env.SETTINGS_ENCRYPTION_KEY;
  process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  const cipher = new SecretCipherService();
  cipher.onModuleInit();
  if (oldKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
  else process.env.SETTINGS_ENCRYPTION_KEY = oldKey;
  return { tx, grant, order, offer, policy: new StandardPlanUpgrade(cipher) };
}

describe('standard plan upgrade quote', () => {
  it('credits the actual discounted amount, not the current list price', async () => {
    const f = fixture();
    const at = new Date('2026-07-02T12:00:00Z');
    const q = await f.policy.quote(
      f.tx as never,
      'user',
      'target',
      undefined,
      at,
    );
    expect(q.data.creditCents).toBe(5000);
    expect(q.data.targetRemainingCents).toBe(12000);
    expect(q.data.payableCents).toBe(7000);
    expect(q.data.endsAt).toBe('2027-01-01T00:00:00.000Z');
    expect(f.policy.decode(q.token)).toEqual(q.data);
  });
  it.each([
    [1, '2028-01-31T00:00:00Z', '2028-02-29T00:00:00Z'],
    [3, '2026-01-31T00:00:00Z', '2026-04-30T00:00:00Z'],
    [12, '2028-02-29T00:00:00Z', '2029-02-28T00:00:00Z'],
  ] as const)(
    'accepts a %i month actual calendar purchase interval',
    async (months, start, end) => {
      const f = fixture(months, start, end);
      const at = new Date(new Date(start).getTime() + 86400000);
      await expect(
        f.policy.quote(f.tx as never, 'user', 'target', undefined, at),
      ).resolves.toMatchObject({
        data: { endsAt: new Date(end).toISOString() },
      });
    },
  );
  it('uses integer cents even at a nearly exhausted interval', () => {
    expect(
      remainingValue(
        19999,
        new Date(0),
        new Date(86400000),
        new Date(86300000),
      ),
    ).toBe(23);
  });
  it('keeps a quote valid during ordinary traffic consumption', async () => {
    const f = fixture(),
      now = new Date('2026-10-14');
    const q = await f.policy.quote(
      f.tx as never,
      'user',
      'target',
      undefined,
      now,
    );
    f.grant.quotaBuckets[0].consumedBytes += 10n;
    await expect(
      f.policy.quote(
        f.tx as never,
        'user',
        'target',
        q.token,
        new Date(+now + 1000),
      ),
    ).resolves.toMatchObject({ data: { payableCents: q.data.payableCents } });
  });
  it.each([
    'user',
    'target',
    'expiry',
    'quota',
    'validity',
    'reservation',
    'refund',
    'renewal',
    'free',
    'downgrade',
    'period',
    'group',
  ] as const)('rejects incompatible %s state', async (kind) => {
    const f = fixture(),
      now = new Date('2026-10-14');
    const q = await f.policy.quote(
      f.tx as never,
      'user',
      'target',
      undefined,
      now,
    );
    let user = 'user',
      offer = 'target',
      at = new Date(+now + 1000),
      token: string | undefined = q.token;
    if (kind === 'user') user = 'other';
    if (kind === 'target') offer = 'other';
    if (kind === 'expiry') at = new Date(+now + 16 * 60000);
    if (kind === 'quota') f.grant.quotaBuckets[0].grantedBytes += 1n;
    if (kind === 'validity') f.grant.endsAt = new Date('2027-02-01');
    if (kind === 'reservation')
      f.tx.entitlementGrant.findMany.mockResolvedValue([
        f.grant,
        { ...f.grant, id: 'next' },
      ]);
    if (kind === 'refund') f.order.refunds.push({ status: 'APPLIED' } as never);
    if (kind === 'renewal') f.grant.orders.push({ ...f.order, id: 'renewal' });
    if (kind === 'free') f.order.source = 'ADMIN';
    if (kind === 'downgrade') {
      f.offer.trafficBytes = 100n;
      token = undefined;
    }
    if (kind === 'period') {
      f.offer.billingPeriod = 'MONTHLY';
      token = undefined;
    }
    if (kind === 'group')
      f.tx.groupBuyMember.findUnique.mockResolvedValue({ id: 'group' });
    await expect(
      f.policy.quote(f.tx as never, user, offer, token, at),
    ).rejects.toThrow();
  });
  it('rejects unsigned or tampered quote payloads', async () => {
    const f = fixture(),
      q = await f.policy.quote(
        f.tx as never,
        'user',
        'target',
        undefined,
        new Date('2026-10-14'),
      );
    expect(() => f.policy.decode(JSON.stringify(q.data))).toThrow();
    expect(() =>
      f.policy.decode(q.token.slice(0, -12) + 'aaaaaaaaaaaa'),
    ).toThrow();
  });
  it('refuses credit after an arbitrary admin validity extension', async () => {
    const f = fixture();
    f.grant.endsAt = new Date('2027-02-01');
    f.order.entitlementExpiresAt = f.grant.endsAt;
    await expect(
      f.policy.quote(
        f.tx as never,
        'user',
        'target',
        undefined,
        new Date('2026-10-14'),
      ),
    ).rejects.toThrow('购买周期');
  });
});

describe('upgrade entitlement mutation', () => {
  it('adds only quota difference, retaining usage, dates, resets and other grants', async () => {
    const f = fixture(),
      now = new Date('2026-10-14'),
      { data: q } = await f.policy.quote(
        f.tx as never,
        'user',
        'target',
        undefined,
        now,
      );
    const bucket = {
      ...f.grant.quotaBuckets[0],
      grant: {
        ...f.grant,
        accessAccountId: 'account',
        legacySubscription: { cycles: [{ id: 'cycle' }] },
      },
    };
    const tx = {
      entitlementGrant: {
        findFirstOrThrow: jest.fn().mockResolvedValue(f.grant),
        update: jest.fn(),
      },
      quotaBucket: {
        findFirst: jest.fn().mockResolvedValue(bucket),
        findUnique: jest.fn().mockResolvedValue(bucket),
        update: jest.fn(),
      },
      quotaAdjustment: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'adjustment' }),
      },
      subscriptionCycle: { update: jest.fn() },
      subscription: { update: jest.fn() },
    };
    await new EntitlementService({} as never).upgradeStandardPlan(
      tx as never,
      q,
      'upgrade-order',
      now,
    );
    expect(tx.quotaBucket.update).toHaveBeenCalledWith({
      where: { id: 'bucket' },
      data: { grantedBytes: { increment: 100n } },
    });
    expect(tx.subscriptionCycle.update).toHaveBeenCalledWith({
      where: { id: 'cycle' },
      data: { adjustmentBytes: { increment: 100n } },
    });
    const grantCalls = tx.entitlementGrant.update.mock
      .calls as unknown as Array<[{ data: Record<string, unknown> }]>;
    const subscriptionCalls = tx.subscription.update.mock
      .calls as unknown as Array<[{ data: Record<string, unknown> }]>;
    expect(grantCalls[0][0].data).toMatchObject({
      productId: 'plus',
      trafficBytesSnapshot: 250n,
    });
    for (const call of [grantCalls[0][0], subscriptionCalls[0][0]]) {
      expect(call.data.endsAt).toBeUndefined();
      expect(call.data.startsAt).toBeUndefined();
      expect(call.data.consumedBytes).toBeUndefined();
      expect(call.data.resetAnchorAt).toBeUndefined();
    }
  });
});
