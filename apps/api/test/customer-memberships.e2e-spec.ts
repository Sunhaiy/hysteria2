import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { EntitlementService } from '../src/entitlement/entitlement.service';
import { CustomerAdminService } from '../src/customer-admin/customer-admin.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Explicitly isolated database: never run these mutation tests against production.
describe('customer memberships with PostgreSQL', () => {
  let p: PrismaClient;
  let service: EntitlementService;
  let customers: CustomerAdminService;
  let userId: string;
  let accountId: string;
  let profileId: string;
  let productId: string;
  let offerId: string;
  let planId: string;
  let nodeId: string;
  let campaignId: string;
  let currentId: string;
  let targetId: string;
  let orderId: string;
  const prefix = `customer-test-${randomUUID()}`;
  const now = new Date('2028-01-31T04:00:00Z');
  const future = new Date('2028-03-01T04:00:00Z');
  const end = new Date('2028-06-01T04:00:00Z');

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/seo_brief_test')
      throw new Error('Requires isolated local seo_brief_test');
    p = new PrismaClient();
    service = new EntitlementService(p as PrismaService);
    customers = new CustomerAdminService(
      p as PrismaService,
      {} as never,
      service,
    );
    profileId = (
      await p.accessProfile.create({
        data: {
          slug: prefix,
          name: '验收节点权限',
          speedUpMbps: 50,
          speedDownMbps: 100,
          deviceLimit: 3,
        },
      })
    ).id;
    productId = (
      await p.catalogProduct.create({
        data: {
          slug: prefix,
          name: '验收套餐',
          kind: 'PLAN',
          status: 'ACTIVE',
          quotaCadence: 'MONTHLY_RESET',
          accessProfileId: profileId,
        },
      })
    ).id;
    offerId = (
      await p.catalogOffer.create({
        data: {
          slug: prefix,
          productId,
          name: '季付',
          billingPeriod: 'QUARTERLY',
          intervalMonths: 3,
          trafficBytes: 1000n,
          priceCents: 3000,
        },
      })
    ).id;
    planId = (
      await p.plan.create({
        data: {
          slug: prefix,
          name: '兼容套餐',
          trafficBytes: 1000n,
          durationDays: 90,
          speedUpMbps: 50,
          speedDownMbps: 100,
          deviceLimit: 3,
          priceCents: 3000,
        },
      })
    ).id;
    nodeId = (
      await p.node.create({
        data: {
          label: prefix,
          hostname: prefix + '.invalid',
          port: 443,
          trafficApiBaseUrl: 'http://127.0.0.1:1',
          trafficApiSecret: 'test-only',
          speedUpMbps: 50,
          speedDownMbps: 100,
          active: false,
        },
      })
    ).id;
    campaignId = (await p.groupBuyCampaign.create({ data: { offerId } })).id;
  });
  beforeEach(async () => {
    jest
      .useFakeTimers({
        doNotFake: [
          'nextTick',
          'setImmediate',
          'setTimeout',
          'clearTimeout',
          'performance',
        ],
      })
      .setSystemTime(now);
    userId = (
      await p.user.create({
        data: {
          email: `${randomUUID()}@customer-test.invalid`,
          displayName: '验收用户',
          passwordHash: 'not-a-login-password',
        },
      })
    ).id;
    accountId = (await p.accessAccount.create({ data: { userId } })).id;
    currentId = await grant(new Date('2028-01-01T04:00:00Z'), future, 200n);
    targetId = await grant(future, end);
    orderId = (
      await p.manualOrder.create({
        data: {
          userId,
          kind: 'RENEWAL',
          source: 'PAYMENT',
          status: 'APPLIED',
          amountCents: 3000,
          catalogOfferId: offerId,
          entitlementGrantId: targetId,
          intervalMonthsSnapshot: 3,
          billingPeriodSnapshot: 'QUARTERLY',
        },
      })
    ).id;
  });
  afterEach(async () => {
    jest.useRealTimers();
    if (!userId) return;
    await p.refund.deleteMany({ where: { order: { userId } } });
    await p.groupBuy.deleteMany({ where: { creatorId: userId } });
    await p.auditLog.deleteMany({
      where: { OR: [{ actorId: userId }, { targetId: userId }] },
    });
    await p.user.delete({ where: { id: userId } });
    await p.catalogProduct.deleteMany({
      where: { slug: { startsWith: prefix + '-extra-' } },
    });
  });
  afterAll(async () => {
    if (!p) return;
    if (campaignId)
      await p.groupBuyCampaign.delete({ where: { id: campaignId } });
    if (offerId) await p.catalogOffer.delete({ where: { id: offerId } });
    if (productId) await p.catalogProduct.delete({ where: { id: productId } });
    if (planId) await p.plan.delete({ where: { id: planId } });
    if (nodeId) await p.node.delete({ where: { id: nodeId } });
    if (profileId) await p.accessProfile.delete({ where: { id: profileId } });
    await p.$disconnect();
  });
  async function grant(startsAt: Date, endsAt: Date, consumedBytes = 0n) {
    const sub = await p.subscription.create({
      data: {
        userId,
        accessAccountId: accountId,
        planId,
        nodeId,
        startsAt,
        endsAt,
        includedTrafficBytes: 1000n,
        speedUpMbpsSnapshot: 50,
        speedDownMbpsSnapshot: 100,
        deviceLimitSnapshot: 3,
        cycles: {
          create: { startsAt, endsAt, grantedBytes: 1000n, consumedBytes },
        },
      },
    });
    return (
      await p.entitlementGrant.create({
        data: {
          userId,
          accessAccountId: accountId,
          productId,
          offerId,
          legacySubscriptionId: sub.id,
          kind: 'PLAN',
          startsAt,
          endsAt,
          resetAnchorAt: startsAt,
          quotaCadenceSnapshot: 'MONTHLY_RESET',
          accessProfileId: profileId,
          speedUpMbpsSnapshot: 50,
          speedDownMbpsSnapshot: 100,
          deviceLimitSnapshot: 3,
          quotaBuckets: {
            create: {
              kind: 'PLAN_CYCLE',
              startsAt,
              endsAt,
              grantedBytes: 1000n,
              consumedBytes,
            },
          },
        },
      })
    ).id;
  }
  async function confirm(key = randomUUID()) {
    const preview = await service.previewScheduledActivation(userId, targetId);
    const input = {
      expectedState: preview.expectedState,
      reason: '已购套餐提前启用验收',
    };
    return {
      input,
      result: await service.activateScheduledPlan(
        userId,
        targetId,
        input,
        userId,
        key,
      ),
      key,
    };
  }
  it.each([
    [1, '2028-02-29T04:00:00.000Z'],
    [3, '2028-04-30T04:00:00.000Z'],
    [12, '2029-01-31T04:00:00.000Z'],
  ])(
    'starts full %i-month paid term with calendar clamp',
    async (months, expected) => {
      await p.manualOrder.update({
        where: { id: orderId },
        data: { intervalMonthsSnapshot: Number(months) },
      });
      const originalOrder = await p.manualOrder.findUniqueOrThrow({
        where: { id: orderId },
      });
      await confirm();
      const target = await p.entitlementGrant.findUniqueOrThrow({
        where: { id: targetId },
        include: {
          quotaBuckets: true,
          legacySubscription: { include: { cycles: true } },
        },
      });
      expect(target.startsAt).toEqual(now);
      expect(target.endsAt.toISOString()).toBe(expected);
      expect(target.quotaBuckets[0].endsAt.toISOString()).toBe(
        '2028-02-29T04:00:00.000Z',
      );
      expect(target.legacySubscription?.cycles[0].startsAt).toEqual(now);
      expect(target.legacySubscription?.endsAt).toEqual(target.endsAt);
      expect(
        await p.manualOrder.findUnique({ where: { id: orderId } }),
      ).toEqual(originalOrder);
      expect(await p.manualOrder.count({ where: { userId } })).toBe(1);
      expect(
        await p.entitlementGrant.count({
          where: { userId, kind: 'PLAN', status: 'ACTIVE' },
        }),
      ).toBe(1);
      expect(
        (
          await p.quotaBucket.findFirstOrThrow({
            where: { grantId: currentId },
          })
        ).consumedBytes,
      ).toBe(200n);
    },
  );
  it('executes two concurrent identical confirmations once', async () => {
    const preview = await service.previewScheduledActivation(userId, targetId);
    const input = {
      expectedState: preview.expectedState,
      reason: '重复提交验收',
    };
    const key = randomUUID();
    const results = await Promise.all([
      service.activateScheduledPlan(userId, targetId, input, userId, key),
      service.activateScheduledPlan(userId, targetId, input, userId, key),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(
      await p.auditLog.count({
        where: { targetId: userId, action: 'entitlement.scheduled.activated' },
      }),
    ).toBe(1);
    await expect(
      service.activateScheduledPlan(
        userId,
        targetId,
        { ...input, reason: '不同请求' },
        userId,
        key,
      ),
    ).rejects.toThrow('幂等');
  });
  it('rejects stale preview after concurrent renewal/date edit', async () => {
    const preview = await service.previewScheduledActivation(userId, targetId);
    await p.entitlementGrant.update({
      where: { id: currentId },
      data: { endsAt: new Date('2028-03-02T00:00:00Z') },
    });
    await expect(
      service.activateScheduledPlan(
        userId,
        targetId,
        { expectedState: preview.expectedState, reason: '验收' },
        userId,
        randomUUID(),
      ),
    ).rejects.toThrow('状态已变化');
  });
  it('rejects a target automatically activated since preview', async () => {
    const preview = await service.previewScheduledActivation(userId, targetId);
    jest.setSystemTime(new Date('2028-03-02T00:00:00Z'));
    await expect(
      service.activateScheduledPlan(
        userId,
        targetId,
        { expectedState: preview.expectedState, reason: '验收' },
        userId,
        randomUUID(),
      ),
    ).rejects.toThrow('尚未生效');
  });
  it('rejects used target, ambiguous reservations and missing period', async () => {
    const bucket = await p.quotaBucket.findFirstOrThrow({
      where: { grantId: targetId },
    });
    await p.quotaBucket.update({
      where: { id: bucket.id },
      data: { consumedBytes: 1n },
    });
    await expect(
      service.previewScheduledActivation(userId, targetId),
    ).rejects.toThrow('已使用');
    await p.quotaBucket.update({
      where: { id: bucket.id },
      data: { consumedBytes: 0n },
    });
    const other = await grant(new Date('2028-07-01'), new Date('2028-08-01'));
    await expect(
      service.previewScheduledActivation(userId, targetId),
    ).rejects.toThrow('多个');
    await p.entitlementGrant.update({
      where: { id: other },
      data: { status: 'CANCELED' },
    });
    await p.manualOrder.update({
      where: { id: orderId },
      data: { intervalMonthsSnapshot: null },
    });
    await expect(
      service.previewScheduledActivation(userId, targetId),
    ).rejects.toThrow('完整购买周期');
  });
  it('leap-day yearly activation clamps to February 28', async () => {
    jest.setSystemTime(new Date('2028-02-29T04:00:00Z'));
    await p.manualOrder.update({
      where: { id: orderId },
      data: { intervalMonthsSnapshot: 12 },
    });
    await confirm();
    expect(
      (
        await p.entitlementGrant.findUniqueOrThrow({ where: { id: targetId } })
      ).endsAt.toISOString(),
    ).toBe('2029-02-28T04:00:00.000Z');
  });
  it('preserves independent packs and permanent Ultra alongside a switched ordinary plan', async () => {
    const ultraProduct = await p.catalogProduct.create({
      data: {
        slug: prefix + '-extra-ultra',
        name: '永久 Ultra',
        kind: 'PLAN',
        series: 'ULTRA',
        quotaCadence: 'ONE_TIME',
      },
    });
    const ultra = await p.entitlementGrant.create({
      data: {
        userId,
        accessAccountId: accountId,
        productId: ultraProduct.id,
        kind: 'PLAN',
        startsAt: new Date('2028-01-01'),
        endsAt: new Date('9999-12-31T00:00:00Z'),
        activeSlot: 'ULTRA',
        accessProfileId: profileId,
        speedUpMbpsSnapshot: 50,
        speedDownMbpsSnapshot: 100,
        deviceLimitSnapshot: 3,
      },
    });
    const pack = await p.trafficPack.create({
      data: {
        userId,
        accessAccountId: accountId,
        label: '独立流量',
        totalBytes: 300n,
        remainingBytes: 200n,
      },
    });
    const packGrant = await p.entitlementGrant.create({
      data: {
        userId,
        accessAccountId: accountId,
        productId,
        legacyTrafficPackId: pack.id,
        kind: 'TRAFFIC_PACK',
        startsAt: new Date('2028-01-01'),
        endsAt: new Date('9999-12-31'),
        accessProfileId: profileId,
        speedUpMbpsSnapshot: 50,
        speedDownMbpsSnapshot: 100,
        deviceLimitSnapshot: 3,
        quotaBuckets: {
          create: {
            kind: 'TRAFFIC_PACK',
            startsAt: new Date('2028-01-01'),
            endsAt: new Date('9999-12-31'),
            grantedBytes: 300n,
            consumedBytes: 100n,
          },
        },
      },
    });
    await confirm();
    expect(
      await p.entitlementGrant.findUnique({ where: { id: ultra.id } }),
    ).toEqual(ultra);
    expect(
      await p.entitlementGrant.findUnique({ where: { id: packGrant.id } }),
    ).toEqual(packGrant);
    const bucket = await p.quotaBucket.findFirstOrThrow({
      where: { grantId: packGrant.id },
    });
    await service.adjustQuotaBucketRemaining(
      bucket.id,
      400,
      '流量包调整',
      userId,
      { userId, expectedRemainingBytes: 200 },
    );
    expect(
      await p.trafficPack.findUnique({ where: { id: pack.id } }),
    ).toMatchObject({
      totalBytes: 500n,
      remainingBytes: 400n,
      expiresAt: null,
    });
    const projection = await customers.getCustomerEntitlements(userId, {
      scope: 'current',
    });
    expect(projection.items.find((g) => g.id === ultra.id)).toMatchObject({
      group: 'ultra',
      permanent: true,
      canActivate: false,
      canAdjustValidity: false,
    });
    expect(projection.items.find((g) => g.id === packGrant.id)).toMatchObject({
      group: 'pack',
      permanent: true,
    });
  });
  it('late group success follows the activated grant, keeping original order snapshot immutable', async () => {
    await p.manualOrder.update({
      where: { id: orderId },
      data: { entitlementExpiresAt: end },
    });
    await confirm();
    const result = await service.createBonusTrafficGrantFromOrder(p, {
      orderId,
      userId,
      productId,
      startsAt: now,
      bytes: 90n,
    });
    const bonus = await p.entitlementGrant.findUniqueOrThrow({
      where: { id: result.grantId },
    });
    expect(bonus.startsAt).toEqual(now);
    expect(bonus.endsAt.toISOString()).toBe('2028-04-30T04:00:00.000Z');
    expect(
      (await p.manualOrder.findUniqueOrThrow({ where: { id: orderId } }))
        .entitlementExpiresAt,
    ).toEqual(end);
  });
  it('rejects refund pending without changing the purchase', async () => {
    await p.refund.create({
      data: {
        orderId,
        method: 'MANUAL',
        amountCents: 3000,
        reason: '验收退款',
      },
    });
    await expect(
      service.previewScheduledActivation(userId, targetId),
    ).rejects.toThrow('退款');
    expect(
      (await p.entitlementGrant.findUniqueOrThrow({ where: { id: targetId } }))
        .startsAt,
    ).toEqual(future);
  });
  it('guards balance previews and does not double credit retries', async () => {
    const key = randomUUID();
    await customers.adjustBalance(userId, 1000, '余额验收', userId, key, 0);
    await customers.adjustBalance(userId, 1000, '余额验收', userId, key, 0);
    expect(
      (await p.user.findUniqueOrThrow({ where: { id: userId } })).balanceCents,
    ).toBe(1000);
    expect(await p.walletLedgerEntry.count({ where: { userId } })).toBe(1);
    await expect(
      customers.adjustBalance(userId, 2000, '余额验收', userId, key, 0),
    ).rejects.toThrow('幂等');
    await expect(
      customers.adjustBalance(
        userId,
        1000,
        '余额验收',
        userId,
        randomUUID(),
        0,
      ),
    ).rejects.toThrow('余额已变化');
  });
  it('returns no usable quota for canceled or expired plans', async () => {
    await p.entitlementGrant.update({
      where: { id: currentId },
      data: { endsAt: new Date('2028-01-30') },
    });
    await p.entitlementGrant.update({
      where: { id: targetId },
      data: { status: 'CANCELED' },
    });
    expect(
      (await customers.getCustomerEntitlements(userId, { scope: 'current' }))
        .items,
    ).toHaveLength(0);
    const history = await customers.getCustomerEntitlements(userId, {
      scope: 'history',
    });
    expect(history.items.map((g) => g.displayState).sort()).toEqual([
      'canceled',
      'expired',
    ]);
    expect(
      history.items.every((g) => g.buckets.every((b) => !b.canAdjust)),
    ).toBe(true);
  });
  it('exposes anomalous parallel current plans and refuses activation', async () => {
    await grant(new Date('2028-01-15'), future);
    const projection = await customers.getCustomerEntitlements(userId, {
      scope: 'current',
    });
    expect(
      projection.items.filter(
        (g) => g.group === 'standard' && g.displayState === 'current',
      ),
    ).toHaveLength(2);
    await expect(
      service.previewScheduledActivation(userId, targetId),
    ).rejects.toThrow('多个');
  });
  it('guards multiplier previews and records user-scoped adjustment history', async () => {
    await service.updateTrafficMultiplier(userId, 2, userId, {
      expectedMultiplier: 1,
      reason: '倍率验收',
    });
    await expect(
      service.updateTrafficMultiplier(userId, 3, userId, {
        expectedMultiplier: 1,
        reason: '过期页面',
      }),
    ).rejects.toThrow('倍率已变化');
    const history = await customers.getCustomerTimeline(userId, {});
    expect(
      history.items.some(
        (e) => e.action === 'entitlement.traffic_multiplier.updated',
      ),
    ).toBe(true);
  });
  it('moves an earned group reward without issuing more quota or changing rate/access', async () => {
    const bonus = await p.entitlementGrant.create({
      data: {
        userId,
        accessAccountId: accountId,
        productId,
        kind: 'TRAFFIC_PACK',
        startsAt: future,
        endsAt: end,
        accessProfileId: profileId,
        speedUpMbpsSnapshot: 50,
        speedDownMbpsSnapshot: 100,
        deviceLimitSnapshot: 3,
        trafficMultiplierBasisPointsSnapshot: 20000,
        quotaBuckets: {
          create: {
            kind: 'TRAFFIC_PACK',
            startsAt: future,
            endsAt: end,
            grantedBytes: 80n,
            trafficMultiplierBasisPointsSnapshot: 20000,
          },
        },
      },
    });
    await p.groupBuy.create({
      data: {
        creatorId: userId,
        campaignId,
        shareCode: randomUUID(),
        status: 'SUCCEEDED',
        offerIdSnapshot: offerId,
        productNameSnapshot: '验收套餐',
        offerNameSnapshot: '季付',
        priceCentsSnapshot: 3000,
        entitlementSnapshot: {},
        members: {
          create: {
            userId,
            orderId,
            bonusEntitlementGrantId: bonus.id,
            status: 'FULFILLED',
          },
        },
      },
    });
    await confirm();
    const actual = await p.entitlementGrant.findUniqueOrThrow({
      where: { id: bonus.id },
      include: { quotaBuckets: true },
    });
    expect(actual.startsAt).toEqual(now);
    expect(actual.endsAt.toISOString()).toBe('2028-04-30T04:00:00.000Z');
    expect(actual.accessProfileId).toBe(profileId);
    expect(actual.trafficMultiplierBasisPointsSnapshot).toBe(20000);
    expect(actual.quotaBuckets[0].grantedBytes).toBe(80n);
  });
  it('adjusts only a current owned bucket and mirrors the legacy cycle', async () => {
    const bucket = await p.quotaBucket.findFirstOrThrow({
      where: { grantId: currentId },
    });
    await service.adjustQuotaBucketRemaining(
      bucket.id,
      500,
      '客服验收',
      userId,
      { userId, expectedRemainingBytes: 800 },
    );
    const actual = await p.quotaBucket.findUniqueOrThrow({
      where: { id: bucket.id },
    });
    expect(actual.consumedBytes).toBe(200n);
    expect(actual.grantedBytes).toBe(700n);
    expect(actual.endsAt).toEqual(bucket.endsAt);
    const g = await p.entitlementGrant.findUniqueOrThrow({
      where: { id: currentId },
    });
    const cycle = await p.subscriptionCycle.findFirstOrThrow({
      where: { subscriptionId: g.legacySubscriptionId! },
    });
    expect(
      cycle.grantedBytes + cycle.adjustmentBytes - cycle.consumedBytes,
    ).toBe(500n);
    await expect(
      service.adjustQuotaBucketRemaining(bucket.id, 800, '客服验收', userId, {
        userId: 'someone-else',
        expectedRemainingBytes: 500,
      }),
    ).rejects.toThrow('没有此额度');
    await expect(
      service.adjustQuotaBucketRemaining(bucket.id, 800, '客服验收', userId, {
        userId,
        expectedRemainingBytes: 800,
      }),
    ).rejects.toThrow('已变化');
    const pending = await p.quotaBucket.findFirstOrThrow({
      where: { grantId: targetId },
    });
    await expect(
      service.adjustQuotaBucketRemaining(pending.id, 800, '客服验收', userId, {
        userId,
        expectedRemainingBytes: 1000,
      }),
    ).rejects.toThrow('当前生效');
  });
  it('keeps current/reserved outside historical pagination and shows grant expiry separately', async () => {
    const historyId = await grant(
      new Date('2027-01-01'),
      new Date('2027-02-01'),
    );
    const live = await customers.getCustomerEntitlements(userId, {
      scope: 'current',
      page: '9',
      pageSize: '1',
    });
    expect(live.items.map((g) => g.id).sort()).toEqual(
      [currentId, targetId].sort(),
    );
    expect(live.items.find((g) => g.id === targetId)).toMatchObject({
      displayState: 'scheduled',
      canAdjustValidity: false,
      canActivate: true,
      endsAt: end.toISOString(),
    });
    const history = await customers.getCustomerEntitlements(userId, {
      scope: 'history',
      page: '1',
      pageSize: '1',
    });
    expect(history.items[0]).toMatchObject({
      id: historyId,
      displayState: 'expired',
      canActivate: false,
    });
  });
});
