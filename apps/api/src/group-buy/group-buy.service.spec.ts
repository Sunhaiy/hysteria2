import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  BillingPeriod,
  CatalogProductKind,
  CatalogProductSeries,
  CatalogProductStatus,
  EpayPaymentStatus,
  GroupBuyMemberStatus,
  GroupBuySettlementMode,
  GroupBuyStatus,
  Prisma,
  QuotaCadence,
} from '@prisma/client';
import { snapshotCatalogOffer } from '../commerce/catalog-offer-snapshot';
import { GroupBuyService } from './group-buy.service';
import { EntitlementService } from '../entitlement/entitlement.service';

const GIB = 1024 ** 3;
const GROUP_BONUS_BYTES = BigInt(20 * GIB);
const GROUP_DISCOUNT_BASIS_POINTS = 10_000;

describe('GroupBuyService', () => {
  afterEach(() => jest.useRealTimers());

  function offer(slug = 'start') {
    return {
      id: `offer-${slug}`,
      productId: `product-${slug}`,
      legacyPlanOfferId: null,
      slug: `${slug}-monthly`,
      name: '月付',
      billingPeriod: BillingPeriod.MONTHLY,
      intervalMonths: 1,
      trafficBytes: BigInt(120 * GIB),
      priceCents: 1290,
      currency: 'CNY',
      active: true,
      archivedAt: null,
      legacyPlanOffer: null,
      product: {
        id: `product-${slug}`,
        slug,
        name: slug === 'go' ? 'Go' : 'Start',
        kind: CatalogProductKind.PLAN,
        series: CatalogProductSeries.STANDARD,
        status: CatalogProductStatus.ACTIVE,
        quotaCadence: QuotaCadence.MONTHLY_RESET,
        accessProfileId: 'profile-standard',
        accessProfile: {
          id: 'profile-standard',
          speedUpMbps: 100,
          speedDownMbps: 300,
          deviceLimit: 100,
        },
        defaultTrafficMultiplierBasisPoints: 10_000,
        requiresActivePlan: false,
        purchaseLimitPerUser: null,
        purchaseLimitKey: null,
        legacyPlanId: `plan-${slug}`,
        legacyPlan: {
          id: `plan-${slug}`,
          name: slug === 'go' ? 'Go' : 'Start',
        },
        legacyTrafficPackProductId: null,
      },
    };
  }

  function campaign(
    catalogOffer = offer(),
    options: {
      discountBasisPoints?: number;
      bonusTrafficBytes?: bigint;
    } = {},
  ) {
    return {
      id: 'campaign-1',
      offerId: catalogOffer.id,
      enabled: true,
      requiredMembers: 2,
      durationMinutes: 1440,
      discountBasisPoints:
        options.discountBasisPoints ?? GROUP_DISCOUNT_BASIS_POINTS,
      bonusTrafficBytes: options.bonusTrafficBytes ?? GROUP_BONUS_BYTES,
      offer: catalogOffer,
    };
  }

  function group(
    catalogOffer = offer(),
    options: {
      discountBasisPoints?: number;
      bonusTrafficBytes?: bigint;
      priceCents?: number;
      settlementMode?: GroupBuySettlementMode;
    } = {},
  ) {
    const discountBasisPoints =
      options.discountBasisPoints ?? GROUP_DISCOUNT_BASIS_POINTS;
    const bonusTrafficBytes = options.bonusTrafficBytes ?? GROUP_BONUS_BYTES;
    const priceCents = options.priceCents ?? catalogOffer.priceCents;
    const settlementMode =
      options.settlementMode ??
      GroupBuySettlementMode.UPFRONT_DISCOUNT_REFUND_ON_FAILURE;
    return {
      id: 'group-1',
      campaignId: 'campaign-1',
      creatorId: 'creator-1',
      shareCode: 'SHARECODE',
      status: GroupBuyStatus.OPEN,
      offerIdSnapshot: catalogOffer.id,
      productNameSnapshot: catalogOffer.product.name,
      offerNameSnapshot: catalogOffer.name,
      priceCentsSnapshot: priceCents,
      currencySnapshot: catalogOffer.currency,
      requiredMembersSnapshot: 2,
      discountBasisPointsSnapshot: discountBasisPoints,
      bonusTrafficBytesSnapshot: bonusTrafficBytes,
      settlementModeSnapshot: settlementMode,
      entitlementSnapshot: snapshotCatalogOffer(catalogOffer as never, {
        purchaseMode: 'group_buy',
        groupBuyId: 'group-1',
        groupBuyMemberId: 'member-creator',
        groupBuyBonusBytes: bonusTrafficBytes.toString(),
        groupBuyOriginalPriceCents: catalogOffer.priceCents,
        groupBuyPriceCents: priceCents,
        groupBuyDiscountBasisPoints: discountBasisPoints,
        groupBuySettlementMode: settlementMode,
      }),
      openedAt: new Date('2026-09-07T01:00:00.000Z'),
      expiresAt: new Date('2026-09-08T01:00:00.000Z'),
      completedAt: null,
    };
  }

  function payment(
    id: string,
    userId: string,
    status: EpayPaymentStatus = EpayPaymentStatus.SETTLED,
  ) {
    return {
      id,
      userId,
      offerId: 'offer-start',
      orderId: null,
      merchantOrderNo: `EPG-${id}`,
      gatewayTradeNo: `gateway-${id}`,
      status,
      paymentType: 'alipay',
      amountCents: 1290,
      basePriceCents: 1290,
      entitlementSnapshot: snapshotCatalogOffer(
        offer() as never,
      ) as unknown as Prisma.JsonObject,
      settledAt:
        status === EpayPaymentStatus.SETTLED
          ? new Date('2026-09-07T02:00:00.000Z')
          : null,
    };
  }

  function service(
    prisma: object,
    commerce: object = {},
    entitlements?: object,
    paymentAttempts?: object,
  ) {
    return new GroupBuyService(
      prisma as never,
      commerce as never,
      (entitlements ?? new EntitlementService(prisma as never)) as never,
      paymentAttempts as never,
    );
  }

  it('allows a member whose previous payment closed to join the open group again', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-07T05:00:00.000Z'));
    const currentGroup = {
      ...group(),
      members: [
        {
          id: 'member-closed',
          userId: 'user-1',
          isCreator: false,
          status: GroupBuyMemberStatus.PAYMENT_CLOSED,
          paidAt: null,
          orderId: null,
          createdAt: new Date('2026-09-07T02:00:00.000Z'),
          user: { displayName: 'Tester' },
        },
      ],
    };
    const prisma = {
      groupBuy: { findFirst: jest.fn().mockResolvedValue(currentGroup) },
    };

    await expect(
      service(prisma).detailForMember('user-1', currentGroup.id),
    ).resolves.toMatchObject({ canJoin: true });
  });

  it('keeps open groups visible to users whose prior payment was closed', async () => {
    const prisma = {
      groupBuy: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    await service(prisma).listForMember('user-1', { scope: 'open' });

    const [groupQuery] = prisma.groupBuy.findMany.mock.calls[0] as unknown as [
      {
        where: {
          members: {
            none: {
              userId: string;
              status: { not: GroupBuyMemberStatus };
            };
          };
        };
      },
    ];
    expect(groupQuery.where.members.none).toEqual({
      userId: 'user-1',
      status: { not: GroupBuyMemberStatus.PAYMENT_CLOSED },
    });
  });

  it('lets the creator cancel an open balance-rebate group without revoking the activated plan', async () => {
    const canceledAt = new Date('2026-09-07T06:00:00.000Z');
    const creator = {
      id: 'member-creator',
      userId: 'creator-1',
      isCreator: true,
      status: GroupBuyMemberStatus.FULFILLED,
      activeSlot: 'standard-plan:creator-1',
      orderId: 'order-creator',
      paidAt: new Date('2026-09-07T02:00:00.000Z'),
      user: { displayName: 'Creator' },
      paymentAttempt: null,
    };
    const currentGroup = {
      ...group(offer(), {
        settlementMode: GroupBuySettlementMode.ORIGINAL_PRICE_BALANCE_REBATE,
      }),
      creatorId: creator.userId,
      members: [creator],
    };
    const canceledGroup = {
      ...currentGroup,
      status: GroupBuyStatus.CANCELED,
      completedAt: canceledAt,
      members: [{ ...creator, activeSlot: null }],
    };
    const tx = {
      groupBuy: {
        findUnique: jest.fn().mockResolvedValue(currentGroup),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(canceledGroup),
      },
      groupBuyMember: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };

    await expect(
      service(prisma).cancelForCreator(
        creator.userId,
        currentGroup.id,
        canceledAt,
      ),
    ).resolves.toMatchObject({
      id: currentGroup.id,
      status: 'canceled',
      canCancel: false,
      viewerMemberId: creator.id,
    });

    expect(tx.groupBuy.updateMany).toHaveBeenCalledWith({
      where: { id: currentGroup.id, status: GroupBuyStatus.OPEN },
      data: { status: GroupBuyStatus.CANCELED, completedAt: canceledAt },
    });
    expect(tx.groupBuyMember.updateMany).toHaveBeenCalledWith({
      where: {
        groupId: currentGroup.id,
        userId: creator.userId,
        isCreator: true,
        activeSlot: { not: null },
      },
      data: { activeSlot: null },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: creator.userId,
        action: 'group_buy.canceled',
        targetType: 'group_buy',
        targetId: currentGroup.id,
        metadata: {
          retainedOrderId: creator.orderId,
          retainedEntitlement: true,
          rewardsGranted: false,
        },
      },
    });
  });

  it('rejects cancellation by another member or after a second member starts joining', async () => {
    const creator = {
      id: 'member-creator',
      userId: 'creator-1',
      isCreator: true,
      status: GroupBuyMemberStatus.FULFILLED,
      activeSlot: 'standard-plan:creator-1',
      orderId: 'order-creator',
      paidAt: new Date('2026-09-07T02:00:00.000Z'),
      user: { displayName: 'Creator' },
      paymentAttempt: null,
    };
    const joiningMember = {
      ...creator,
      id: 'member-joiner',
      userId: 'user-2',
      isCreator: false,
      status: GroupBuyMemberStatus.PAYMENT_PENDING,
      activeSlot: 'standard-plan:user-2',
      orderId: null,
      paidAt: null,
      user: { displayName: 'Joiner' },
    };
    const currentGroup = {
      ...group(offer(), {
        settlementMode: GroupBuySettlementMode.ORIGINAL_PRICE_BALANCE_REBATE,
      }),
      members: [creator],
    };
    const groupBuy = {
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(currentGroup)
        .mockResolvedValueOnce({
          ...currentGroup,
          members: [creator, joiningMember],
        }),
      updateMany: jest.fn(),
    };
    const tx = {
      groupBuy,
      groupBuyMember: { updateMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const groupBuys = service(prisma);
    const beforeExpiry = new Date('2026-09-07T06:00:00.000Z');

    await expect(
      groupBuys.cancelForCreator('user-2', currentGroup.id, beforeExpiry),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      groupBuys.cancelForCreator('creator-1', currentGroup.id, beforeExpiry),
    ).rejects.toThrow('已有成员正在参团，不能取消');
    expect(groupBuy.updateMany).not.toHaveBeenCalled();
  });

  it('rejects cancellation after the group has completed', async () => {
    const currentGroup = {
      ...group(offer(), {
        settlementMode: GroupBuySettlementMode.ORIGINAL_PRICE_BALANCE_REBATE,
      }),
      status: GroupBuyStatus.SUCCEEDED,
      completedAt: new Date('2026-09-07T03:00:00.000Z'),
      members: [],
    };
    const tx = {
      groupBuy: { findUnique: jest.fn().mockResolvedValue(currentGroup) },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };

    await expect(
      service(prisma).cancelForCreator('creator-1', currentGroup.id),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('filters and exposes unrecovered group rebate debt for administrators', async () => {
    const currentGroup = {
      ...group(),
      members: [
        {
          id: 'member-debt',
          userId: 'user-1',
          isCreator: true,
          status: GroupBuyMemberStatus.FULFILLED,
          orderId: 'order-1',
          paidAt: new Date('2026-09-07T02:00:00.000Z'),
          rebateWalletLedgerId: 'ledger-rebate',
          rebateRecoveredCents: 200,
          rebateUnrecoveredCents: 300,
          user: {
            id: 'user-1',
            email: 'member@example.com',
            displayName: 'Member',
          },
          paymentAttempt: null,
          order: { amountCents: 1290 },
          refundAttempt: null,
        },
      ],
    };
    const prisma = {
      groupBuy: {
        findMany: jest.fn().mockResolvedValue([currentGroup]),
        count: jest.fn().mockResolvedValue(1),
      },
    };

    const result = await service(prisma).listAdmin({
      exceptionsOnly: 'true',
    });

    const [request] = prisma.groupBuy.findMany.mock.calls[0] as unknown as [
      { where: Prisma.GroupBuyWhereInput },
    ];
    expect(Array.isArray(request.where.AND)).toBe(true);
    expect(JSON.stringify(request.where.AND)).toContain(
      '"rebateUnrecoveredCents":{"gt":0}',
    );
    expect(result.items[0]?.members[0]).toMatchObject({
      rebateRecoveredCents: 200,
      rebateUnrecoveredCents: 300,
    });
  });

  it('creates a Start group with immutable price and entitlement snapshots', async () => {
    const catalogOffer = offer();
    const createdGroups: Array<Record<string, unknown>> = [];
    const createdMembers: Array<Record<string, unknown>> = [];
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      groupBuyCampaign: {
        findUnique: jest.fn().mockResolvedValue(campaign(catalogOffer)),
      },
      groupBuyMember: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          createdMembers.push(data);
          return Promise.resolve({
            ...data,
            status: GroupBuyMemberStatus.PAYMENT_PENDING,
            paymentAttempt: null,
          });
        }),
      },
      groupBuy: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          createdGroups.push(data);
          return Promise.resolve({
            ...data,
            status: GroupBuyStatus.PENDING_PAYMENT,
          });
        }),
      },
      subscription: { findFirst: jest.fn().mockResolvedValue(null) },
      epayPaymentAttempt: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    const result = await service({}).preparePayment(
      tx as never,
      'creator-1',
      { kind: 'create', campaignId: 'campaign-1' },
      new Date('2026-09-07T00:00:00.000Z'),
    );

    expect(createdGroups[0]).toMatchObject({
      campaignId: 'campaign-1',
      creatorId: 'creator-1',
      offerIdSnapshot: catalogOffer.id,
      priceCentsSnapshot: 1290,
      requiredMembersSnapshot: 2,
      discountBasisPointsSnapshot: GROUP_DISCOUNT_BASIS_POINTS,
      bonusTrafficBytesSnapshot: GROUP_BONUS_BYTES,
      settlementModeSnapshot:
        GroupBuySettlementMode.ORIGINAL_PRICE_BALANCE_REBATE,
    });
    expect(createdMembers[0]).toMatchObject({
      userId: 'creator-1',
      isCreator: true,
      activeSlot: 'standard-plan:creator-1',
    });
    expect(result.snapshot).toMatchObject({
      purchaseMode: 'group_buy',
      planActivationPreference: null,
      planActivationMode: 'initial',
      planEffectiveAt: '2026-09-07T00:00:00.000Z',
      productSlug: 'start',
      groupBuyBonusBytes: GROUP_BONUS_BYTES.toString(),
      groupBuyOriginalPriceCents: 1290,
      groupBuyPriceCents: 1290,
      groupBuyDiscountBasisPoints: GROUP_DISCOUNT_BASIS_POINTS,
      groupBuySettlementMode:
        GroupBuySettlementMode.ORIGINAL_PRICE_BALANCE_REBATE,
    });
    expect(typeof result.snapshot.groupBuyId).toBe('string');
    expect(typeof result.snapshot.groupBuyMemberId).toBe('string');
    expect(
      (createdGroups[0]?.entitlementSnapshot as Record<string, unknown>)
        .planActivationMode,
    ).toBeNull();
    expect(
      (createdMembers[0]?.entitlementSnapshot as Record<string, unknown>)
        .planActivationMode,
    ).toBe('initial');
  });

  it('forces a same-plan group purchase to renew without clearing current usage', async () => {
    const now = new Date('2026-09-08T08:00:00.000Z');
    const endsAt = new Date('2026-10-08T08:00:00.000Z');
    const catalogOffer = offer();
    const createdMembers: Array<Record<string, unknown>> = [];
    const currentPlan = {
      id: 'subscription-start',
      planId: 'plan-start',
      startsAt: new Date('2026-08-08T08:00:00.000Z'),
      endsAt,
      plan: {
        id: 'plan-start',
        name: 'Start',
        catalogProduct: { id: 'product-start', name: 'Start' },
      },
    };
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      groupBuyCampaign: {
        findUnique: jest.fn().mockResolvedValue(campaign(catalogOffer)),
      },
      groupBuyMember: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          createdMembers.push(data);
          return Promise.resolve({
            ...data,
            status: GroupBuyMemberStatus.PAYMENT_PENDING,
            paymentAttempt: null,
          });
        }),
      },
      groupBuy: {
        create: jest.fn(({ data }) =>
          Promise.resolve({
            ...data,
            status: GroupBuyStatus.PENDING_PAYMENT,
          }),
        ),
      },
      subscription: {
        findFirst: jest.fn(
          ({ where }: { where: { startsAt?: { lte?: Date } } }) =>
            Promise.resolve(where.startsAt?.lte ? currentPlan : null),
        ),
      },
      epayPaymentAttempt: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    const result = await service({}).preparePayment(
      tx as never,
      'creator-1',
      { kind: 'create', campaignId: 'campaign-1' },
      now,
      'immediate_switch',
    );

    expect(result.snapshot).toMatchObject({
      planActivationPreference: null,
      planActivationMode: 'renewal',
      planEffectiveAt: endsAt.toISOString(),
      currentPlanProductId: 'product-start',
      currentPlanName: 'Start',
      currentPlanEndsAt: endsAt.toISOString(),
    });
    expect(
      (createdMembers[0]?.entitlementSnapshot as Record<string, unknown>)
        .planActivationMode,
    ).toBe('renewal');
  });

  it('blocks another group purchase when a future plan is already scheduled', async () => {
    const now = new Date('2026-09-08T08:00:00.000Z');
    const catalogOffer = offer();
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      groupBuyCampaign: {
        findUnique: jest.fn().mockResolvedValue(campaign(catalogOffer)),
      },
      groupBuyMember: { findFirst: jest.fn().mockResolvedValue(null) },
      subscription: {
        findFirst: jest.fn(
          ({ where }: { where: { startsAt?: { gt?: Date } } }) =>
            Promise.resolve(
              where.startsAt?.gt
                ? { id: 'scheduled-subscription' }
                : {
                    id: 'current-subscription',
                    planId: 'plan-start',
                    startsAt: new Date('2026-08-08T08:00:00.000Z'),
                    endsAt: new Date('2026-10-08T08:00:00.000Z'),
                    plan: {
                      id: 'plan-start',
                      name: 'Start',
                      catalogProduct: { id: 'product-start', name: 'Start' },
                    },
                  },
            ),
        ),
      },
      epayPaymentAttempt: { findUnique: jest.fn().mockResolvedValue(null) },
      groupBuy: { create: jest.fn() },
    };

    await expect(
      service({}).preparePayment(
        tx as never,
        'creator-1',
        { kind: 'create', campaignId: 'campaign-1' },
        now,
      ),
    ).rejects.toThrow('当前仅可重置本期流量');
    expect(tx.groupBuy.create).not.toHaveBeenCalled();
  });

  it('calculates a joining member switch independently from the creator snapshot', async () => {
    const now = new Date('2026-09-08T08:00:00.000Z');
    const currentEndsAt = new Date('2026-10-08T08:00:00.000Z');
    const targetOffer = offer();
    const creatorSnapshot = snapshotCatalogOffer(targetOffer as never, {
      purchaseMode: 'group_buy',
      groupBuyId: 'group-1',
      groupBuyMemberId: 'member-creator',
      groupBuyBonusBytes: GROUP_BONUS_BYTES.toString(),
      groupBuyOriginalPriceCents: targetOffer.priceCents,
      groupBuyPriceCents: targetOffer.priceCents,
      groupBuyDiscountBasisPoints: GROUP_DISCOUNT_BASIS_POINTS,
      groupBuySettlementMode:
        GroupBuySettlementMode.ORIGINAL_PRICE_BALANCE_REBATE,
      planActivationPreference: 'immediate_switch',
      planActivationMode: 'immediate_switch',
      planEffectiveAt: now.toISOString(),
    });
    const currentGroup = {
      ...group(targetOffer, {
        settlementMode: GroupBuySettlementMode.ORIGINAL_PRICE_BALANCE_REBATE,
      }),
      entitlementSnapshot: creatorSnapshot,
      expiresAt: new Date('2026-09-09T08:00:00.000Z'),
      members: [
        {
          id: 'member-creator',
          userId: 'creator-1',
          status: GroupBuyMemberStatus.FULFILLED,
        },
      ],
    };
    const currentPlan = {
      id: 'subscription-pro',
      planId: 'plan-pro',
      startsAt: new Date('2026-08-08T08:00:00.000Z'),
      endsAt: currentEndsAt,
      plan: {
        id: 'plan-pro',
        name: 'Pro',
        catalogProduct: { id: 'product-pro', name: 'Pro' },
      },
    };
    const createTx = () => ({
      user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      groupBuy: { findUnique: jest.fn().mockResolvedValue(currentGroup) },
      groupBuyMember: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }) =>
          Promise.resolve({
            ...data,
            status: GroupBuyMemberStatus.PAYMENT_PENDING,
            paymentAttempt: null,
          }),
        ),
      },
      catalogOffer: { findUnique: jest.fn().mockResolvedValue(targetOffer) },
      subscription: {
        findFirst: jest.fn(
          ({ where }: { where: { startsAt?: { lte?: Date } } }) =>
            Promise.resolve(where.startsAt?.lte ? currentPlan : null),
        ),
      },
      epayPaymentAttempt: { findUnique: jest.fn().mockResolvedValue(null) },
    });

    const scheduled = await service({}).preparePayment(
      createTx() as never,
      'joiner-scheduled',
      { kind: 'join', groupId: currentGroup.id },
      now,
    );
    const immediate = await service({}).preparePayment(
      createTx() as never,
      'joiner-immediate',
      { kind: 'join', groupId: currentGroup.id },
      now,
      'immediate_switch',
    );

    expect(scheduled.snapshot).toMatchObject({
      planActivationPreference: 'scheduled_switch',
      planActivationMode: 'scheduled_switch',
      planEffectiveAt: currentEndsAt.toISOString(),
      currentPlanProductId: 'product-pro',
    });
    expect(immediate.snapshot).toMatchObject({
      planActivationPreference: 'immediate_switch',
      planActivationMode: 'immediate_switch',
      planEffectiveAt: now.toISOString(),
      currentPlanProductId: 'product-pro',
    });
    expect(typeof scheduled.snapshot.groupBuyMemberId).toBe('string');
    expect(typeof immediate.snapshot.groupBuyMemberId).toBe('string');
    expect(scheduled.snapshot.groupBuyMemberId).not.toBe(
      creatorSnapshot.groupBuyMemberId,
    );
  });

  it('snapshots the configured discount and per-member traffic bonus', async () => {
    const catalogOffer = offer();
    const bonusTrafficBytes = BigInt(36 * GIB);
    const configuredCampaign = campaign(catalogOffer, {
      discountBasisPoints: 8_500,
      bonusTrafficBytes,
    });
    let createdGroup: Record<string, unknown> | null = null;
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      groupBuyCampaign: {
        findUnique: jest.fn().mockResolvedValue(configuredCampaign),
      },
      groupBuyMember: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }) =>
          Promise.resolve({
            ...data,
            status: GroupBuyMemberStatus.PAYMENT_PENDING,
            paymentAttempt: null,
          }),
        ),
      },
      groupBuy: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          createdGroup = data;
          return Promise.resolve({
            ...data,
            status: GroupBuyStatus.PENDING_PAYMENT,
          });
        }),
      },
      subscription: { findFirst: jest.fn().mockResolvedValue(null) },
      epayPaymentAttempt: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    const result = await service({}).preparePayment(tx as never, 'creator-1', {
      kind: 'create',
      campaignId: configuredCampaign.id,
    });

    expect(createdGroup).toMatchObject({
      priceCentsSnapshot: 1097,
      discountBasisPointsSnapshot: 8_500,
      bonusTrafficBytesSnapshot: bonusTrafficBytes,
      settlementModeSnapshot:
        GroupBuySettlementMode.ORIGINAL_PRICE_BALANCE_REBATE,
    });
    expect(result.snapshot).toMatchObject({
      groupBuyOriginalPriceCents: 1290,
      groupBuyPriceCents: 1097,
      groupBuyDiscountBasisPoints: 8_500,
      groupBuyBonusBytes: bonusTrafficBytes.toString(),
      groupBuySettlementMode:
        GroupBuySettlementMode.ORIGINAL_PRICE_BALANCE_REBATE,
    });
  });

  it('rejects a second campaign while the account has an active plan group', async () => {
    const catalogOffer = offer();
    const activeMember = {
      id: 'member-existing',
      userId: 'creator-1',
      status: GroupBuyMemberStatus.FULFILLED,
      group: { ...group(), campaignId: 'campaign-other' },
      paymentAttempt: null,
    };
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      groupBuyCampaign: {
        findUnique: jest.fn().mockResolvedValue(campaign(catalogOffer)),
      },
      groupBuyMember: {
        findFirst: jest.fn().mockResolvedValue(activeMember),
      },
    };

    await expect(
      service({}).preparePayment(tx as never, 'creator-1', {
        kind: 'create',
        campaignId: 'campaign-1',
      }),
    ).rejects.toThrow('你已有进行中的套餐拼团');
  });

  it('rejects Go and expired groups', async () => {
    const goOffer = offer('go');
    const createTx = {
      user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      groupBuyCampaign: {
        findUnique: jest.fn().mockResolvedValue(campaign(goOffer)),
      },
    };
    await expect(
      service({}).preparePayment(createTx as never, 'user-1', {
        kind: 'create',
        campaignId: 'campaign-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const expired = {
      ...group(),
      expiresAt: new Date('2026-09-07T00:00:00.000Z'),
      members: [],
    };
    const joinTx = {
      user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      groupBuy: { findUnique: jest.fn().mockResolvedValue(expired) },
    };
    await expect(
      service({}).preparePayment(
        joinTx as never,
        'user-2',
        { kind: 'join', groupId: expired.id },
        new Date('2026-09-07T00:00:00.001Z'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('opens a creator-paid group for exactly 24 hours without early fulfillment', async () => {
    const paidAt = new Date('2026-09-07T03:04:05.000Z');
    const creatorPayment = payment(
      'payment-creator',
      'creator-1',
      EpayPaymentStatus.PENDING,
    );
    const currentGroup = {
      ...group(),
      status: GroupBuyStatus.PENDING_PAYMENT,
      openedAt: null,
      expiresAt: null,
    };
    const member = {
      id: 'member-creator',
      groupId: currentGroup.id,
      userId: 'creator-1',
      isCreator: true,
      status: GroupBuyMemberStatus.PAYMENT_PENDING,
      orderId: null,
      paymentAttemptId: creatorPayment.id,
      group: currentGroup,
      paymentAttempt: creatorPayment,
    };
    const tx = {
      groupBuyMember: {
        findUnique: jest.fn().mockResolvedValue(member),
        update: jest.fn().mockResolvedValue(member),
      },
      epayPaymentAttempt: {
        update: jest.fn(({ data }) =>
          Promise.resolve({ ...creatorPayment, ...data }),
        ),
      },
      groupBuy: { update: jest.fn().mockResolvedValue(currentGroup) },
    };
    const commerce = { fulfillEpayPayment: jest.fn() };

    await service({}, commerce).settleVerifiedPayment(
      tx as never,
      creatorPayment as never,
      {
        attemptId: creatorPayment.id,
        userId: creatorPayment.userId,
        offerId: creatorPayment.offerId,
        merchantOrderNo: creatorPayment.merchantOrderNo,
        gatewayTradeNo: creatorPayment.gatewayTradeNo,
        amountCents: creatorPayment.amountCents,
        basePriceCents: creatorPayment.basePriceCents,
        entitlementSnapshot: creatorPayment.entitlementSnapshot,
        paidAt,
      },
      {
        ...creatorPayment.entitlementSnapshot,
        purchaseMode: 'group_buy',
        groupBuyId: currentGroup.id,
        groupBuyMemberId: member.id,
        groupBuyBonusBytes: GROUP_BONUS_BYTES.toString(),
      } as never,
    );

    expect(tx.groupBuy.update).toHaveBeenCalledWith({
      where: { id: currentGroup.id },
      data: {
        status: GroupBuyStatus.OPEN,
        openedAt: paidAt,
        expiresAt: new Date(paidAt.getTime() + 24 * 60 * 60 * 1000),
      },
    });
    expect(commerce.fulfillEpayPayment).not.toHaveBeenCalled();
  });

  it('activates the original-price plan immediately for a new rebate-mode creator', async () => {
    const paidAt = new Date('2026-09-07T03:04:05.000Z');
    const creatorPayment = payment(
      'payment-creator-new',
      'creator-1',
      EpayPaymentStatus.PENDING,
    );
    const currentGroup = {
      ...group(offer(), {
        priceCents: 1097,
        discountBasisPoints: 8_500,
        settlementMode: GroupBuySettlementMode.ORIGINAL_PRICE_BALANCE_REBATE,
      }),
      status: GroupBuyStatus.PENDING_PAYMENT,
      openedAt: null,
      expiresAt: null,
    };
    const member = {
      id: 'member-creator',
      groupId: currentGroup.id,
      userId: 'creator-1',
      isCreator: true,
      status: GroupBuyMemberStatus.PAYMENT_PENDING,
      orderId: null,
      paymentAttemptId: creatorPayment.id,
      group: currentGroup,
      paymentAttempt: creatorPayment,
    };
    const tx = {
      groupBuyMember: {
        findUnique: jest.fn().mockResolvedValue(member),
        update: jest.fn().mockResolvedValue(member),
      },
      epayPaymentAttempt: {
        update: jest.fn(({ data }) =>
          Promise.resolve({ ...creatorPayment, ...data }),
        ),
        findUniqueOrThrow: jest.fn().mockResolvedValue(creatorPayment),
      },
      groupBuy: {
        findUnique: jest.fn().mockResolvedValue(currentGroup),
        update: jest.fn().mockResolvedValue(currentGroup),
      },
    };
    const commerce = {
      fulfillEpayPayment: jest
        .fn()
        .mockResolvedValue({ orderId: 'order-creator' }),
    };

    await service({}, commerce).settleVerifiedPayment(
      tx as never,
      creatorPayment as never,
      {
        attemptId: creatorPayment.id,
        userId: creatorPayment.userId,
        offerId: creatorPayment.offerId,
        merchantOrderNo: creatorPayment.merchantOrderNo,
        gatewayTradeNo: creatorPayment.gatewayTradeNo,
        amountCents: 1290,
        basePriceCents: 1290,
        entitlementSnapshot: currentGroup.entitlementSnapshot as never,
        paidAt,
      },
      currentGroup.entitlementSnapshot,
    );

    expect(commerce.fulfillEpayPayment).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        amountCents: 1290,
        entitlementStartsAt: paidAt,
      }),
    );
    const memberWrites = tx.groupBuyMember.update.mock
      .calls as unknown as Array<
      [
        {
          where: { id: string };
          data: {
            status?: GroupBuyMemberStatus;
            orderId?: string;
            paidAt?: Date;
          };
        },
      ]
    >;
    const fulfilledMemberWrite = memberWrites.find(
      ([input]) => input.data.status === GroupBuyMemberStatus.FULFILLED,
    )?.[0];
    expect(fulfilledMemberWrite).toMatchObject({
      where: { id: member.id },
      data: {
        status: GroupBuyMemberStatus.FULFILLED,
        orderId: 'order-creator',
        paidAt,
      },
    });
    expect(tx.groupBuy.update).toHaveBeenCalledWith({
      where: { id: currentGroup.id },
      data: {
        status: GroupBuyStatus.OPEN,
        openedAt: paidAt,
        expiresAt: new Date(paidAt.getTime() + 24 * 60 * 60 * 1000),
      },
    });
  });

  it('uses the original price for wallet payment and opens the group after fulfillment', async () => {
    const currentGroup = {
      ...group(offer(), {
        priceCents: 1097,
        discountBasisPoints: 8_500,
        settlementMode: GroupBuySettlementMode.ORIGINAL_PRICE_BALANCE_REBATE,
      }),
      status: GroupBuyStatus.PENDING_PAYMENT,
      openedAt: null,
      expiresAt: null,
    };
    const member = {
      id: 'member-wallet',
      groupId: currentGroup.id,
      userId: 'creator-1',
      isCreator: true,
      paidAt: null,
      walletIdempotencyKey: null,
      paymentAttempt: null,
    };
    const tx = {
      groupBuyMember: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(member),
      },
      groupBuy: {
        findUnique: jest.fn().mockResolvedValue(currentGroup),
        findUniqueOrThrow: jest.fn().mockResolvedValue(currentGroup),
        update: jest.fn().mockResolvedValue(currentGroup),
      },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const commerce = {
      fulfillGroupBuyWalletPayment: jest
        .fn()
        .mockResolvedValue({ orderId: 'order-wallet' }),
    };
    const paymentAttempts = {
      abandonPendingPayments: jest.fn().mockResolvedValue(['attempt-old']),
    };
    const groupBuys = service(prisma, commerce, undefined, paymentAttempts);
    jest.spyOn(groupBuys, 'preparePayment').mockResolvedValue({
      group: currentGroup,
      member,
      offer: offer(),
      existingAttempt: null,
      snapshot: currentGroup.entitlementSnapshot,
    } as never);

    await expect(
      groupBuys.purchaseWithWallet(
        'creator-1',
        { kind: 'create', campaignId: 'campaign-1' },
        'wallet-request-1',
      ),
    ).resolves.toMatchObject({
      status: 'settled',
      paymentType: 'balance',
      amountCents: 1290,
      orderId: 'order-wallet',
    });
    expect(commerce.fulfillGroupBuyWalletPayment).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        userId: 'creator-1',
        memberId: member.id,
        amountCents: 1290,
        basePriceCents: 1290,
      }),
    );
    expect(paymentAttempts.abandonPendingPayments).toHaveBeenCalledWith(
      tx,
      'creator-1',
      expect.any(Date),
    );
    const groupWrites = tx.groupBuy.update.mock.calls as unknown as Array<
      [{ where: { id: string }; data: { status: GroupBuyStatus } }]
    >;
    const openGroupWrite = groupWrites[0]?.[0];
    expect(openGroupWrite).toMatchObject({
      where: { id: currentGroup.id },
      data: { status: GroupBuyStatus.OPEN },
    });
  });

  it('reserves only the second slot once the serializable transaction sees it occupied', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-07T05:00:00.000Z'));
    const currentGroup = {
      ...group(),
      members: [
        {
          id: 'member-creator',
          userId: 'creator-1',
          status: GroupBuyMemberStatus.PAID,
        },
        {
          id: 'member-second',
          userId: 'user-2',
          status: GroupBuyMemberStatus.PAYMENT_PENDING,
        },
      ],
    };
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      groupBuy: { findUnique: jest.fn().mockResolvedValue(currentGroup) },
      groupBuyMember: { findFirst: jest.fn().mockResolvedValue(null) },
      subscription: { findFirst: jest.fn().mockResolvedValue(null) },
      epayPaymentAttempt: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    await expect(
      service({}).preparePayment(tx as never, 'user-3', {
        kind: 'join',
        groupId: currentGroup.id,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('accepts a late successful payment from an earlier retry and closes the newer pending attempt', async () => {
    const paidAt = new Date('2026-09-07T05:00:00.000Z');
    const oldAttempt = payment(
      'payment-old',
      'user-2',
      EpayPaymentStatus.PENDING,
    );
    const currentGroup = {
      ...group(),
      settlementModeSnapshot:
        GroupBuySettlementMode.ORIGINAL_PRICE_BALANCE_REBATE,
      status: GroupBuyStatus.OPEN,
      expiresAt: new Date('2026-09-08T05:00:00.000Z'),
    };
    const member = {
      id: 'member-joining',
      groupId: currentGroup.id,
      userId: 'user-2',
      isCreator: false,
      status: GroupBuyMemberStatus.PAYMENT_PENDING,
      paymentAttemptId: 'payment-newer',
      orderId: null,
      group: currentGroup,
      paymentAttempt: { id: 'payment-newer' },
    };
    const tx = {
      groupBuyMember: {
        findUnique: jest.fn().mockResolvedValue(member),
        update: jest.fn().mockResolvedValue(member),
      },
      epayPaymentAttempt: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(({ data }) =>
          Promise.resolve({ ...oldAttempt, ...data }),
        ),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...oldAttempt,
          status: EpayPaymentStatus.SETTLED,
        }),
      },
      groupBuy: {
        findUnique: jest.fn().mockResolvedValue({
          ...currentGroup,
          members: [],
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const commerce = {
      fulfillEpayPayment: jest.fn().mockResolvedValue({ orderId: 'order-1' }),
    };

    await expect(
      service({}, commerce).settleVerifiedPayment(
        tx as never,
        oldAttempt as never,
        {
          attemptId: oldAttempt.id,
          userId: oldAttempt.userId,
          offerId: oldAttempt.offerId,
          merchantOrderNo: oldAttempt.merchantOrderNo,
          gatewayTradeNo: 'gateway-old',
          amountCents: oldAttempt.amountCents,
          basePriceCents: oldAttempt.basePriceCents,
          entitlementSnapshot: oldAttempt.entitlementSnapshot,
          paidAt,
        },
        {
          ...oldAttempt.entitlementSnapshot,
          purchaseMode: 'group_buy',
          groupBuyId: currentGroup.id,
          groupBuyMemberId: member.id,
        } as never,
      ),
    ).resolves.toMatchObject({ status: EpayPaymentStatus.SETTLED });

    expect(tx.epayPaymentAttempt.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'payment-newer',
        status: EpayPaymentStatus.PENDING,
      },
      data: {
        status: EpayPaymentStatus.EXPIRED,
        activeKey: null,
        closedAt: paidAt,
      },
    });
    expect(commerce.fulfillEpayPayment).toHaveBeenCalledTimes(1);
  });

  it('fulfills both paid members atomically with the snapshotted bonuses ending with their plans', async () => {
    const paidAt = new Date('2026-09-07T05:00:00.000Z');
    const entitlementEndsAt = new Date('2026-10-07T05:00:00.000Z');
    const creatorPayment = payment('payment-creator', 'creator-1');
    const joiningPayment = payment(
      'payment-joining',
      'user-2',
      EpayPaymentStatus.PENDING,
    );
    const snapshottedBonusBytes = BigInt(37 * GIB);
    const currentGroup = group(offer(), {
      bonusTrafficBytes: snapshottedBonusBytes,
    });
    const joiningMember = {
      id: 'member-joining',
      groupId: currentGroup.id,
      userId: 'user-2',
      isCreator: false,
      status: GroupBuyMemberStatus.PAYMENT_PENDING,
      orderId: null,
      paymentAttemptId: joiningPayment.id,
      group: currentGroup,
      paymentAttempt: joiningPayment,
    };
    const paidMembers = [
      {
        id: 'member-creator',
        groupId: currentGroup.id,
        userId: 'creator-1',
        isCreator: true,
        status: GroupBuyMemberStatus.PAID,
        paymentAttempt: creatorPayment,
      },
      {
        ...joiningMember,
        status: GroupBuyMemberStatus.PAID,
        paymentAttempt: {
          ...joiningPayment,
          status: EpayPaymentStatus.SETTLED,
          settledAt: paidAt,
        },
      },
    ];
    const tx = {
      groupBuyMember: {
        findUnique: jest.fn().mockResolvedValue(joiningMember),
        update: jest.fn().mockResolvedValue(joiningMember),
      },
      epayPaymentAttempt: {
        update: jest.fn(({ data }) => {
          Object.assign(joiningPayment, data);
          return Promise.resolve(joiningPayment);
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(joiningPayment),
      },
      groupBuy: {
        findUnique: jest.fn().mockResolvedValue({
          ...currentGroup,
          members: paidMembers,
        }),
        update: jest.fn().mockResolvedValue(currentGroup),
      },
      manualOrder: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve({
            id: where.id,
            userId: where.id.includes('creator') ? 'creator-1' : 'user-2',
            entitlementExpiresAt: entitlementEndsAt,
            entitlementGrant: {
              id: `plan-grant-${where.id}`,
              userId: where.id.includes('creator') ? 'creator-1' : 'user-2',
              status: 'ACTIVE',
              accessAccountId: `account-${where.id}`,
              accessProfileId: 'profile-standard',
              speedUpMbpsSnapshot: 100,
              speedDownMbpsSnapshot: 300,
              deviceLimitSnapshot: 100,
              trafficMultiplierBasisPointsSnapshot: 10_000,
            },
          }),
        ),
      },
      entitlementGrant: {
        create: jest.fn(),
      },
      quotaBucket: {
        create: jest.fn(),
      },
    };
    const commerce = {
      fulfillEpayPayment: jest.fn(
        (_tx: unknown, { userId }: { userId: string }) =>
          Promise.resolve({ orderId: `order-${userId}` }),
      ),
    };
    const entitlements = {
      createBonusTrafficGrantFromOrder: jest.fn(
        (_tx: unknown, input: { userId: string }) =>
          Promise.resolve({
            grantId: `bonus-${input.userId}`,
            bucketId: `bucket-${input.userId}`,
          }),
      ),
    };

    await service({}, commerce, entitlements).settleVerifiedPayment(
      tx as never,
      joiningPayment as never,
      {
        attemptId: joiningPayment.id,
        userId: joiningPayment.userId,
        offerId: joiningPayment.offerId,
        merchantOrderNo: joiningPayment.merchantOrderNo,
        gatewayTradeNo: joiningPayment.gatewayTradeNo,
        amountCents: joiningPayment.amountCents,
        basePriceCents: joiningPayment.basePriceCents,
        entitlementSnapshot: joiningPayment.entitlementSnapshot,
        paidAt,
      },
      {
        ...joiningPayment.entitlementSnapshot,
        purchaseMode: 'group_buy',
        groupBuyId: currentGroup.id,
        groupBuyMemberId: joiningMember.id,
        groupBuyBonusBytes: snapshottedBonusBytes.toString(),
      } as never,
    );

    expect(commerce.fulfillEpayPayment).toHaveBeenCalledTimes(2);
    expect(commerce.fulfillEpayPayment).toHaveBeenNthCalledWith(
      1,
      tx,
      expect.objectContaining({
        userId: 'creator-1',
        entitlementStartsAt: paidAt,
      }),
    );
    const bonusInputs =
      entitlements.createBonusTrafficGrantFromOrder.mock.calls.map(
        ([, input]) => input,
      );
    expect(bonusInputs).toHaveLength(2);
    expect(bonusInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'creator-1',
          startsAt: paidAt,
          bytes: snapshottedBonusBytes,
        }),
        expect.objectContaining({
          userId: 'user-2',
          startsAt: paidAt,
          bytes: snapshottedBonusBytes,
        }),
      ]),
    );
    expect(tx.groupBuy.update).toHaveBeenLastCalledWith({
      where: { id: currentGroup.id },
      data: { status: GroupBuyStatus.SUCCEEDED, completedAt: paidAt },
    });
  });

  it('does not complete or duplicate fulfillment after a settlement failure or replay', async () => {
    const currentGroup = group();
    const joiningPayment = payment(
      'payment-joining',
      'user-2',
      EpayPaymentStatus.PENDING,
    );
    const joiningMember = {
      id: 'member-joining',
      groupId: currentGroup.id,
      userId: 'user-2',
      isCreator: false,
      status: GroupBuyMemberStatus.PAYMENT_PENDING,
      orderId: null,
      paymentAttemptId: joiningPayment.id,
      group: currentGroup,
      paymentAttempt: joiningPayment,
    };
    const tx = {
      groupBuyMember: {
        findUnique: jest.fn().mockResolvedValue(joiningMember),
        update: jest.fn(),
      },
      epayPaymentAttempt: {
        update: jest.fn(({ data }) =>
          Promise.resolve({ ...joiningPayment, ...data }),
        ),
      },
      groupBuy: {
        findUnique: jest.fn().mockResolvedValue({
          ...currentGroup,
          members: [
            {
              id: 'member-creator',
              groupId: currentGroup.id,
              userId: 'creator-1',
              paymentAttempt: payment('payment-creator', 'creator-1'),
            },
            {
              ...joiningMember,
              paymentAttempt: {
                ...joiningPayment,
                status: EpayPaymentStatus.SETTLED,
                settledAt: new Date('2026-09-07T05:00:00.000Z'),
              },
            },
          ],
        }),
        update: jest.fn(),
      },
      manualOrder: {
        findUnique: jest.fn().mockRejectedValue(new Error('grant failed')),
      },
    };
    const commerce = {
      fulfillEpayPayment: jest
        .fn()
        .mockResolvedValue({ orderId: 'order-creator' }),
    };
    const input = {
      attemptId: joiningPayment.id,
      userId: joiningPayment.userId,
      offerId: joiningPayment.offerId,
      merchantOrderNo: joiningPayment.merchantOrderNo,
      gatewayTradeNo: joiningPayment.gatewayTradeNo,
      amountCents: joiningPayment.amountCents,
      basePriceCents: joiningPayment.basePriceCents,
      entitlementSnapshot: joiningPayment.entitlementSnapshot,
      paidAt: new Date('2026-09-07T05:00:00.000Z'),
    };
    const snapshot = {
      ...joiningPayment.entitlementSnapshot,
      purchaseMode: 'group_buy',
      groupBuyId: currentGroup.id,
      groupBuyMemberId: joiningMember.id,
      groupBuyBonusBytes: GROUP_BONUS_BYTES.toString(),
    };

    await expect(
      service({}, commerce).settleVerifiedPayment(
        tx as never,
        joiningPayment as never,
        input as never,
        snapshot as never,
      ),
    ).rejects.toThrow('grant failed');
    const groupUpdates = tx.groupBuy.update.mock.calls as unknown as Array<
      [{ data: { status?: GroupBuyStatus } }]
    >;
    expect(
      groupUpdates.some(
        ([update]) => update.data.status === GroupBuyStatus.SUCCEEDED,
      ),
    ).toBe(false);

    const replayCommerce = { fulfillEpayPayment: jest.fn() };
    const replayTx = {
      groupBuyMember: {
        findUnique: jest.fn().mockResolvedValue({
          ...joiningMember,
          orderId: 'order-user-2',
          status: GroupBuyMemberStatus.FULFILLED,
        }),
      },
    };
    await expect(
      service({}, replayCommerce).settleVerifiedPayment(
        replayTx as never,
        joiningPayment as never,
        input as never,
        snapshot as never,
      ),
    ).resolves.toBe(joiningPayment);
    expect(replayCommerce.fulfillEpayPayment).not.toHaveBeenCalled();
  });

  it('credits each member once and grants each bonus once when a new group succeeds', async () => {
    const paidAt = new Date('2026-09-07T05:00:00.000Z');
    const entitlementEndsAt = new Date('2026-10-07T05:00:00.000Z');
    const joiningPayment = payment(
      'payment-joining-rebate',
      'user-2',
      EpayPaymentStatus.PENDING,
    );
    const currentGroup = group(offer(), {
      priceCents: 1097,
      discountBasisPoints: 8_500,
      bonusTrafficBytes: BigInt(30 * GIB),
      settlementMode: GroupBuySettlementMode.ORIGINAL_PRICE_BALANCE_REBATE,
    });
    const joiningMember = {
      id: 'member-joining',
      groupId: currentGroup.id,
      userId: 'user-2',
      isCreator: false,
      status: GroupBuyMemberStatus.PAYMENT_PENDING,
      orderId: null,
      paymentAttemptId: joiningPayment.id,
      group: currentGroup,
      paymentAttempt: joiningPayment,
    };
    const fulfilledMembers = [
      {
        id: 'member-creator',
        userId: 'creator-1',
        isCreator: true,
        status: GroupBuyMemberStatus.FULFILLED,
        orderId: 'order-creator',
        bonusEntitlementGrantId: null,
        rebateWalletLedgerId: null,
      },
      {
        id: joiningMember.id,
        userId: joiningMember.userId,
        isCreator: false,
        status: GroupBuyMemberStatus.FULFILLED,
        orderId: 'order-user-2',
        bonusEntitlementGrantId: null,
        rebateWalletLedgerId: null,
      },
    ];
    let ledgerSequence = 0;
    const tx = {
      groupBuyMember: {
        findUnique: jest.fn().mockResolvedValue(joiningMember),
        update: jest.fn().mockResolvedValue(joiningMember),
      },
      epayPaymentAttempt: {
        update: jest.fn(({ data }) =>
          Promise.resolve({ ...joiningPayment, ...data }),
        ),
        findUniqueOrThrow: jest.fn().mockResolvedValue(joiningPayment),
      },
      groupBuy: {
        findUnique: jest.fn((input: { include?: { members?: unknown } }) =>
          Promise.resolve(
            input.include?.members
              ? { ...currentGroup, members: fulfilledMembers }
              : currentGroup,
          ),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(currentGroup),
      },
      manualOrder: {
        findUnique: jest.fn((input: { where: { id: string } }) =>
          Promise.resolve({
            id: input.where.id,
            userId: input.where.id.includes('creator') ? 'creator-1' : 'user-2',
            entitlementExpiresAt: entitlementEndsAt,
            entitlementGrant: {
              id: `grant-${input.where.id}`,
              userId: input.where.id.includes('creator')
                ? 'creator-1'
                : 'user-2',
              status: 'ACTIVE',
              accessAccountId: `account-${input.where.id}`,
              accessProfileId: 'profile-standard',
              speedUpMbpsSnapshot: 100,
              speedDownMbpsSnapshot: 300,
              deviceLimitSnapshot: 100,
              trafficMultiplierBasisPointsSnapshot: 10_000,
            },
          }),
        ),
      },
      entitlementGrant: {
        create: jest.fn((input: { data: { userId: string } }) =>
          Promise.resolve({ id: `bonus-${input.data.userId}` }),
        ),
      },
      quotaBucket: { create: jest.fn().mockResolvedValue({}) },
      walletLedgerEntry: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(
          (_input: { data: { amountCents: number; kind: string } }) => {
            void _input;
            ledgerSequence += 1;
            return Promise.resolve({ id: `rebate-ledger-${ledgerSequence}` });
          },
        ),
      },
      user: {
        update: jest.fn().mockResolvedValue({ balanceCents: 500 }),
      },
      walletTransaction: {
        create: jest.fn(() =>
          Promise.resolve({ id: `wallet-${ledgerSequence + 1}` }),
        ),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const commerce = {
      fulfillEpayPayment: jest
        .fn()
        .mockResolvedValue({ orderId: 'order-user-2' }),
    };
    let bonusSequence = 0;
    const entitlements = {
      createBonusTrafficGrantFromOrder: jest.fn().mockImplementation(() => {
        bonusSequence += 1;
        return Promise.resolve({
          grantId: `bonus-${bonusSequence}`,
          bucketId: `bucket-${bonusSequence}`,
        });
      }),
    };
    const joiningSnapshot = {
      ...currentGroup.entitlementSnapshot,
      groupBuyMemberId: joiningMember.id,
    };

    await service({}, commerce, entitlements).settleVerifiedPayment(
      tx as never,
      joiningPayment as never,
      {
        attemptId: joiningPayment.id,
        userId: joiningPayment.userId,
        offerId: joiningPayment.offerId,
        merchantOrderNo: joiningPayment.merchantOrderNo,
        gatewayTradeNo: joiningPayment.gatewayTradeNo,
        amountCents: 1290,
        basePriceCents: 1290,
        entitlementSnapshot: joiningSnapshot,
        paidAt,
      },
      joiningSnapshot,
    );

    expect(commerce.fulfillEpayPayment).toHaveBeenCalledTimes(1);
    expect(tx.groupBuy.updateMany).toHaveBeenCalledWith({
      where: { id: currentGroup.id, status: GroupBuyStatus.OPEN },
      data: { status: GroupBuyStatus.FULFILLING },
    });
    expect(entitlements.createBonusTrafficGrantFromOrder).toHaveBeenCalledTimes(
      2,
    );
    expect(tx.walletLedgerEntry.create).toHaveBeenCalledTimes(2);
    const rebateWrites = tx.walletLedgerEntry.create.mock.calls.map(
      ([input]) => input,
    );
    expect(rebateWrites).toHaveLength(2);
    expect(rebateWrites[0]?.data).toMatchObject({
      amountCents: 193,
      kind: 'REFUND',
    });
    expect(tx.groupBuy.update).toHaveBeenLastCalledWith({
      where: { id: currentGroup.id },
      data: { status: GroupBuyStatus.SUCCEEDED, completedAt: paidAt },
    });
  });

  it('moves paid members of expired groups into the refund workflow', async () => {
    const expiredAt = new Date('2026-09-08T01:00:00.000Z');
    const creatorPayment = payment('payment-creator', 'creator-1');
    const currentGroup = {
      ...group(),
      expiresAt: expiredAt,
      members: [
        {
          id: 'member-creator',
          paymentAttemptId: creatorPayment.id,
          orderId: null,
          paymentAttempt: creatorPayment,
        },
      ],
    };
    const tx = {
      groupBuy: {
        findUnique: jest.fn().mockResolvedValue(currentGroup),
        update: jest.fn(),
      },
      groupBuyMember: { update: jest.fn() },
      epayRefundAttempt: { upsert: jest.fn() },
      epayPaymentAttempt: { update: jest.fn() },
    };
    const prisma = {
      groupBuy: {
        findMany: jest.fn().mockResolvedValue([{ id: currentGroup.id }]),
      },
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };

    await expect(service(prisma).expireDueGroups(expiredAt)).resolves.toBe(1);
    expect(tx.groupBuyMember.update).toHaveBeenCalledWith({
      where: { id: 'member-creator' },
      data: { status: GroupBuyMemberStatus.REFUND_PENDING },
    });
    expect(tx.epayRefundAttempt.upsert).toHaveBeenCalledWith({
      where: { paymentAttemptId: creatorPayment.id },
      create: {
        paymentAttemptId: creatorPayment.id,
        groupBuyMemberId: 'member-creator',
        amountCents: creatorPayment.amountCents,
        reasonCode: 'GROUP_BUY_EXPIRED',
      },
      update: {},
    });
    expect(tx.groupBuy.update).toHaveBeenCalledWith({
      where: { id: currentGroup.id },
      data: { status: GroupBuyStatus.REFUNDING, completedAt: null },
    });
  });

  it('retains original-price entitlements without refund or rewards when a new group expires', async () => {
    const expiredAt = new Date('2026-09-08T01:00:00.000Z');
    const currentGroup = {
      ...group(offer(), {
        priceCents: 1097,
        discountBasisPoints: 8_500,
        settlementMode: GroupBuySettlementMode.ORIGINAL_PRICE_BALANCE_REBATE,
      }),
      expiresAt: expiredAt,
      members: [
        {
          id: 'member-creator',
          orderId: 'order-creator',
          bonusEntitlementGrantId: null,
          rebateWalletLedgerId: null,
        },
      ],
    };
    const tx = {
      groupBuy: {
        findUnique: jest.fn().mockResolvedValue(currentGroup),
        update: jest.fn(),
      },
      groupBuyMember: { updateMany: jest.fn() },
      epayRefundAttempt: { upsert: jest.fn() },
      entitlementGrant: { create: jest.fn() },
      walletLedgerEntry: { create: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      groupBuy: {
        findMany: jest.fn().mockResolvedValue([{ id: currentGroup.id }]),
      },
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };

    await expect(service(prisma).expireDueGroups(expiredAt)).resolves.toBe(1);
    expect(tx.epayRefundAttempt.upsert).not.toHaveBeenCalled();
    expect(tx.entitlementGrant.create).not.toHaveBeenCalled();
    expect(tx.walletLedgerEntry.create).not.toHaveBeenCalled();
    expect(tx.groupBuy.update).toHaveBeenCalledWith({
      where: { id: currentGroup.id },
      data: {
        status: GroupBuyStatus.FALLBACK_FULFILLED,
        completedAt: expiredAt,
      },
    });
  });

  it('never grants the traffic bonus when an unsuccessful group falls back to the original plan', async () => {
    const now = new Date('2026-09-08T02:00:00.000Z');
    const settledPayment = payment('payment-creator', 'creator-1');
    const member = {
      id: 'member-creator',
      groupId: 'group-1',
      userId: 'creator-1',
      status: GroupBuyMemberStatus.REFUND_PENDING,
      orderId: null,
      paymentAttempt: settledPayment,
      refundAttempt: { fallbackAllowedAt: now },
      group: { ...group(), status: GroupBuyStatus.REFUNDING },
    };
    const entitlementCreate = jest.fn();
    const quotaCreate = jest.fn();
    const tx = {
      groupBuyMember: {
        findUnique: jest.fn().mockResolvedValue(member),
        update: jest.fn().mockResolvedValue(member),
      },
      epayPaymentAttempt: { update: jest.fn() },
      entitlementGrant: { create: entitlementCreate },
      quotaBucket: { create: quotaCreate },
      groupBuy: {
        findUnique: jest.fn().mockResolvedValue({
          ...member.group,
          members: [
            {
              ...member,
              status: GroupBuyMemberStatus.FALLBACK_FULFILLED,
            },
          ],
        }),
        update: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const commerce = {
      fulfillEpayPayment: jest
        .fn()
        .mockResolvedValue({ orderId: 'order-creator' }),
    };

    await expect(
      service(prisma, commerce).fallbackFulfillMember(member.id, now),
    ).resolves.toEqual({ orderId: 'order-creator' });

    expect(commerce.fulfillEpayPayment).toHaveBeenCalledTimes(1);
    expect(entitlementCreate).not.toHaveBeenCalled();
    expect(quotaCreate).not.toHaveBeenCalled();
    const memberUpdates = tx.groupBuyMember.update.mock
      .calls as unknown as Array<
      [
        {
          where: { id: string };
          data: Record<string, unknown>;
        },
      ]
    >;
    const fallbackUpdate = memberUpdates.find(
      ([input]) =>
        input.data.status === GroupBuyMemberStatus.FALLBACK_FULFILLED,
    );
    expect(fallbackUpdate?.[0]).toMatchObject({
      where: { id: member.id },
      data: { bonusEntitlementGrantId: null },
    });
  });
});
