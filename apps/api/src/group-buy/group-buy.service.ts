import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  CatalogProductKind,
  CatalogProductSeries,
  CatalogProductStatus,
  EpayPaymentStatus,
  EpayRefundStatus,
  GroupBuyMemberStatus,
  GroupBuySettlementMode,
  GroupBuyStatus,
  PaymentFulfillmentStatus,
  Prisma,
  type EpayPaymentAttempt,
} from '@prisma/client';
import { pageResponse, parsePage, type PageQuery } from '../common/pagination';
import { webPublicUrl } from '../common/public-url';
import {
  catalogOfferSnapshotInclude,
  parseCatalogOfferSnapshot,
  snapshotCatalogOffer,
  type CatalogOfferSnapshot,
} from '../commerce/catalog-offer-snapshot';
import {
  CommerceService,
  type EpaySettlementInput,
} from '../commerce/commerce.service';
import { PaymentFulfillmentRejectedError } from '../commerce/payment-fulfillment.error';
import { PrismaService } from '../prisma/prisma.service';
import { postWalletEntry, recoverWalletCredit } from '../wallet/wallet-ledger';
import { EntitlementService } from '../entitlement/entitlement.service';
import { PaymentAttemptLifecycleService } from '../payments/payment-attempt-lifecycle.service';
import {
  decidePlanPurchasePolicy,
  standardPlanPurchaseKey,
  type PlanActivationPreference,
  type PlanPurchasePolicy,
} from '../commerce/plan-purchase-policy';

const GROUP_SIZE = 2;
const GROUP_DURATION_MS = 24 * 60 * 60 * 1000;
const GIB = 1024 ** 3;
const BASIS_POINTS = 10_000;
const MIN_GROUP_DISCOUNT_PERCENT = 50;
const DEFAULT_GROUP_DISCOUNT_BASIS_POINTS = BASIS_POINTS;
const DEFAULT_GROUP_BONUS_BYTES = BigInt(20 * GIB);
const GROUP_BONUS_PRODUCT_ID = 'system_group_buy_traffic_bonus';
const BALANCE_REBATE_MODE =
  GroupBuySettlementMode.ORIGINAL_PRICE_BALANCE_REBATE;

function discountedPriceCents(priceCents: number, basisPoints: number) {
  return Math.max(1, Math.round((priceCents * basisPoints) / BASIS_POINTS));
}

function remainingRebateCents(grossCents: number, recoveredCents: number) {
  return Math.max(0, grossCents - Math.max(0, recoveredCents));
}

export interface GroupBuyListQuery extends PageQuery {
  scope?: 'open' | 'mine';
}

export interface AdminGroupBuyQuery extends PageQuery {
  q?: string;
  status?: string;
  campaignId?: string;
  exceptionsOnly?: string;
}

type GroupBuyPaymentMode =
  | { kind: 'create'; campaignId: string }
  | { kind: 'join'; groupId: string };

@Injectable()
export class GroupBuyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerce: CommerceService,
    private readonly entitlements: EntitlementService,
    @Optional()
    private readonly paymentAttempts?: PaymentAttemptLifecycleService,
  ) {}

  async listCampaigns() {
    const campaigns = await this.prisma.groupBuyCampaign.findMany({
      where: {
        enabled: true,
        offer: {
          active: true,
          archivedAt: null,
          product: {
            status: CatalogProductStatus.ACTIVE,
            kind: CatalogProductKind.PLAN,
            series: CatalogProductSeries.STANDARD,
            slug: { not: 'go' },
          },
        },
      },
      include: { offer: { include: { product: true } } },
      orderBy: [
        { offer: { product: { sortOrder: 'asc' } } },
        { offer: { priceCents: 'asc' } },
      ],
    });
    return campaigns.map((campaign) => ({
      id: campaign.id,
      offerId: campaign.offerId,
      productId: campaign.offer.productId,
      productName: campaign.offer.product.name,
      offerName: campaign.offer.name,
      billingPeriod: campaign.offer.billingPeriod.toLowerCase(),
      originalPriceCents: campaign.offer.priceCents,
      priceCents: discountedPriceCents(
        campaign.offer.priceCents,
        campaign.discountBasisPoints,
      ),
      discountPercent: campaign.discountBasisPoints / 100,
      currency: campaign.offer.currency,
      trafficBytes: Number(campaign.offer.trafficBytes),
      requiredMembers: campaign.requiredMembers,
      durationMinutes: campaign.durationMinutes,
      bonusTrafficBytes: Number(campaign.bonusTrafficBytes),
      settlementMode: BALANCE_REBATE_MODE.toLowerCase(),
    }));
  }

  async listForMember(userId: string, query: GroupBuyListQuery) {
    const { page, pageSize, skip } = parsePage(query, {
      defaultPageSize: 12,
      maxPageSize: 50,
    });
    const now = new Date();
    const where: Prisma.GroupBuyWhereInput =
      query.scope === 'mine'
        ? {
            status: { not: GroupBuyStatus.CANCELED },
            members: { some: { userId } },
          }
        : {
            status: GroupBuyStatus.OPEN,
            expiresAt: { gt: now },
            members: {
              none: {
                userId,
                status: { not: GroupBuyMemberStatus.PAYMENT_CLOSED },
              },
            },
          };
    const [groups, total] = await Promise.all([
      this.prisma.groupBuy.findMany({
        where,
        include: {
          members: {
            include: {
              user: { select: { displayName: true } },
              paymentAttempt: { select: { status: true } },
            },
            orderBy: [{ isCreator: 'desc' }, { createdAt: 'asc' }],
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.groupBuy.count({ where }),
    ]);
    return pageResponse(
      groups.map((group) => this.presentGroup(group, userId)),
      total,
      page,
      pageSize,
    );
  }

  async detailForMember(userId: string, idOrCode: string) {
    const group = await this.prisma.groupBuy.findFirst({
      where: { OR: [{ id: idOrCode }, { shareCode: idOrCode }] },
      include: {
        members: {
          include: {
            user: { select: { displayName: true } },
            paymentAttempt: { select: { status: true } },
          },
          orderBy: [{ isCreator: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!group) throw new NotFoundException('拼团不存在');
    const member = group.members.some((item) => item.userId === userId);
    if (!member && group.status !== GroupBuyStatus.OPEN) {
      throw new NotFoundException('拼团不存在');
    }
    return this.presentGroup(group, userId);
  }

  async cancelForCreator(userId: string, groupId: string, now = new Date()) {
    for (let retry = 0; retry < 3; retry += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const group = await tx.groupBuy.findUnique({
              where: { id: groupId },
              include: {
                members: {
                  include: {
                    user: { select: { displayName: true } },
                    paymentAttempt: { select: { status: true } },
                  },
                  orderBy: [{ isCreator: 'desc' }, { createdAt: 'asc' }],
                },
              },
            });
            if (!group) throw new NotFoundException('拼团不存在');
            if (group.creatorId !== userId) {
              throw new ForbiddenException('只有发起人可以取消拼团');
            }
            if (group.status !== GroupBuyStatus.OPEN) {
              throw new ConflictException('该拼团当前不能取消');
            }
            if (group.expiresAt && group.expiresAt <= now) {
              throw new ConflictException('拼团已到期，正在结算');
            }
            if (group.settlementModeSnapshot !== BALANCE_REBATE_MODE) {
              throw new ConflictException('该历史拼团不支持主动取消');
            }
            const occupiedStatuses = new Set<GroupBuyMemberStatus>([
              GroupBuyMemberStatus.PAYMENT_PENDING,
              GroupBuyMemberStatus.PAID,
              GroupBuyMemberStatus.FULFILLED,
            ]);
            if (
              group.members.some(
                (member) =>
                  !member.isCreator && occupiedStatuses.has(member.status),
              )
            ) {
              throw new ConflictException('已有成员正在参团，不能取消');
            }

            const canceled = await tx.groupBuy.updateMany({
              where: { id: group.id, status: GroupBuyStatus.OPEN },
              data: { status: GroupBuyStatus.CANCELED, completedAt: now },
            });
            if (canceled.count !== 1) {
              throw new ConflictException('拼团状态已变化，请刷新后重试');
            }
            const creator = group.members.find((member) => member.isCreator);
            await tx.groupBuyMember.updateMany({
              where: {
                groupId: group.id,
                userId,
                isCreator: true,
                activeSlot: { not: null },
              },
              data: { activeSlot: null },
            });
            await tx.auditLog.create({
              data: {
                actorId: userId,
                action: 'group_buy.canceled',
                targetType: 'group_buy',
                targetId: group.id,
                metadata: {
                  retainedOrderId: creator?.orderId ?? null,
                  retainedEntitlement: true,
                  rewardsGranted: false,
                },
              },
            });
            const result = await tx.groupBuy.findUniqueOrThrow({
              where: { id: group.id },
              include: {
                members: {
                  include: {
                    user: { select: { displayName: true } },
                    paymentAttempt: { select: { status: true } },
                  },
                  orderBy: [{ isCreator: 'desc' }, { createdAt: 'asc' }],
                },
              },
            });
            return this.presentGroup(result, userId);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (this.isRetryableTransactionError(error) && retry < 2) continue;
        throw error;
      }
    }
    throw new ConflictException('取消拼团冲突，请刷新后重试');
  }

  async getAdminCampaigns() {
    const offers = await this.prisma.catalogOffer.findMany({
      where: {
        active: true,
        archivedAt: null,
        product: {
          status: CatalogProductStatus.ACTIVE,
          kind: CatalogProductKind.PLAN,
          series: CatalogProductSeries.STANDARD,
          slug: { not: 'go' },
        },
      },
      include: { product: true, groupBuyCampaign: true },
      orderBy: [{ product: { sortOrder: 'asc' } }, { priceCents: 'asc' }],
    });
    const settings = offers.find(
      (offer) => offer.groupBuyCampaign,
    )?.groupBuyCampaign;
    const discountBasisPoints =
      settings?.discountBasisPoints ?? DEFAULT_GROUP_DISCOUNT_BASIS_POINTS;
    const bonusTrafficBytes =
      settings?.bonusTrafficBytes ?? DEFAULT_GROUP_BONUS_BYTES;
    return {
      requiredMembers: GROUP_SIZE,
      durationMinutes: 24 * 60,
      discountPercent: discountBasisPoints / 100,
      bonusTrafficGiB: Number(bonusTrafficBytes) / GIB,
      bonusTrafficBytes: Number(bonusTrafficBytes),
      offers: offers.map((offer) => ({
        offerId: offer.id,
        productName: offer.product.name,
        offerName: offer.name,
        billingPeriod: offer.billingPeriod.toLowerCase(),
        originalPriceCents: offer.priceCents,
        priceCents: discountedPriceCents(offer.priceCents, discountBasisPoints),
        trafficBytes: Number(offer.trafficBytes),
        enabled: offer.groupBuyCampaign?.enabled ?? false,
        campaignId: offer.groupBuyCampaign?.id ?? null,
      })),
    };
  }

  async updateAdminCampaigns(
    offerIds: string[],
    discountPercent: number,
    bonusTrafficGiB: number,
    actorId: string,
  ) {
    if (
      !Number.isFinite(discountPercent) ||
      discountPercent < MIN_GROUP_DISCOUNT_PERCENT ||
      discountPercent > 100
    ) {
      throw new BadRequestException(
        '拼团成团价必须在 5 折至 10 折之间，9 折请填写 9',
      );
    }
    const uniqueOfferIds = [...new Set(offerIds)];
    const discountBasisPoints = Math.round(discountPercent * 100);
    const bonusTrafficBytes = BigInt(Math.round(bonusTrafficGiB * GIB));
    await this.prisma.$transaction(async (tx) => {
      const offers = await tx.catalogOffer.findMany({
        where: {
          active: true,
          archivedAt: null,
          product: {
            status: CatalogProductStatus.ACTIVE,
            kind: CatalogProductKind.PLAN,
            series: CatalogProductSeries.STANDARD,
            slug: { not: 'go' },
          },
        },
        include: { product: true },
      });
      const eligibleOfferIds = new Set(offers.map((offer) => offer.id));
      if (uniqueOfferIds.some((offerId) => !eligibleOfferIds.has(offerId))) {
        throw new BadRequestException('拼团仅支持 Start 及以上有效普通套餐');
      }
      await tx.groupBuyCampaign.updateMany({
        where: { offerId: { notIn: offers.map((offer) => offer.id) } },
        data: { enabled: false },
      });
      for (const offer of offers) {
        await tx.groupBuyCampaign.upsert({
          where: { offerId: offer.id },
          create: {
            offerId: offer.id,
            enabled: uniqueOfferIds.includes(offer.id),
            requiredMembers: GROUP_SIZE,
            durationMinutes: 24 * 60,
            discountBasisPoints,
            bonusTrafficBytes,
          },
          update: {
            enabled: uniqueOfferIds.includes(offer.id),
            requiredMembers: GROUP_SIZE,
            durationMinutes: 24 * 60,
            discountBasisPoints,
            bonusTrafficBytes,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'group_buy.campaigns_updated',
          targetType: 'group_buy_campaigns',
          metadata: {
            offerIds: uniqueOfferIds,
            discountPercent,
            bonusTrafficGiB,
          },
        },
      });
    });
    return this.getAdminCampaigns();
  }

  async listAdmin(query: AdminGroupBuyQuery) {
    const { page, pageSize, skip } = parsePage(query, {
      defaultPageSize: 20,
      maxPageSize: 100,
    });
    const q = query.q?.trim();
    const status = query.status ? this.groupStatus(query.status) : undefined;
    const exceptionsOnly = query.exceptionsOnly === 'true';
    const where: Prisma.GroupBuyWhereInput = {
      status,
      campaignId: query.campaignId?.trim() || undefined,
      OR: q
        ? [
            { shareCode: { contains: q, mode: 'insensitive' } },
            { productNameSnapshot: { contains: q, mode: 'insensitive' } },
            {
              members: {
                some: { user: { email: { contains: q, mode: 'insensitive' } } },
              },
            },
          ]
        : undefined,
      AND: exceptionsOnly
        ? [
            {
              OR: [
                {
                  status: {
                    in: [GroupBuyStatus.EXCEPTION, GroupBuyStatus.REFUNDING],
                  },
                },
                {
                  members: {
                    some: {
                      OR: [
                        { rebateUnrecoveredCents: { gt: 0 } },
                        {
                          status: {
                            in: [
                              GroupBuyMemberStatus.EXCEPTION,
                              GroupBuyMemberStatus.REFUND_PENDING,
                            ],
                          },
                        },
                        {
                          refundAttempt: {
                            is: {
                              status: {
                                in: [
                                  EpayRefundStatus.PENDING,
                                  EpayRefundStatus.SUBMITTED,
                                  EpayRefundStatus.FAILED,
                                ],
                              },
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          ]
        : undefined,
    };
    const [groups, total] = await Promise.all([
      this.prisma.groupBuy.findMany({
        where,
        include: {
          members: {
            include: {
              user: { select: { id: true, email: true, displayName: true } },
              paymentAttempt: true,
              order: { select: { amountCents: true } },
              rebateWalletLedger: { select: { amountCents: true } },
              refundAttempt: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.groupBuy.count({ where }),
    ]);
    return pageResponse(
      groups.map((group) => ({
        id: group.id,
        shareCode: group.shareCode,
        status: group.status.toLowerCase(),
        productName: group.productNameSnapshot,
        offerName: group.offerNameSnapshot,
        originalPriceCents:
          parseCatalogOfferSnapshot(group.entitlementSnapshot)
            ?.groupBuyOriginalPriceCents ?? group.priceCentsSnapshot,
        priceCents: group.priceCentsSnapshot,
        discountPercent: group.discountBasisPointsSnapshot / 100,
        bonusTrafficBytes: Number(group.bonusTrafficBytesSnapshot),
        settlementMode: group.settlementModeSnapshot.toLowerCase(),
        openedAt: group.openedAt?.toISOString() ?? null,
        expiresAt: group.expiresAt?.toISOString() ?? null,
        completedAt: group.completedAt?.toISOString() ?? null,
        members: group.members.map((member) => ({
          id: member.id,
          userId: member.userId,
          userEmail: member.user.email,
          userDisplayName: member.user.displayName,
          isCreator: member.isCreator,
          status: member.status.toLowerCase(),
          amountCents:
            member.paymentAttempt?.amountCents ??
            member.order?.amountCents ??
            null,
          merchantOrderNo: member.paymentAttempt?.merchantOrderNo ?? null,
          refundAttemptId: member.refundAttempt?.id ?? null,
          refundStatus: member.refundAttempt?.status.toLowerCase() ?? null,
          refundError: member.refundAttempt?.lastError ?? null,
          refundGatewayMessage: member.refundAttempt?.gatewayMessage ?? null,
          fallbackAllowed: Boolean(member.refundAttempt?.fallbackAllowedAt),
          orderId: member.orderId,
          rebateRecoveredCents: member.rebateRecoveredCents,
          rebateUnrecoveredCents: member.rebateUnrecoveredCents,
          rebateCents: remainingRebateCents(
            Math.max(0, member.rebateWalletLedger?.amountCents ?? 0),
            member.rebateRecoveredCents,
          ),
        })),
      })),
      total,
      page,
      pageSize,
    );
  }

  async preparePayment(
    tx: Prisma.TransactionClient,
    userId: string,
    mode: GroupBuyPaymentMode,
    now = new Date(),
    planActivation?: PlanActivationPreference,
  ) {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE') {
      throw new BadRequestException('账户当前不可用');
    }
    if (mode.kind === 'create') {
      const campaign = await tx.groupBuyCampaign.findUnique({
        where: { id: mode.campaignId },
        include: { offer: { include: catalogOfferSnapshotInclude } },
      });
      if (!campaign || !campaign.enabled) {
        throw new BadRequestException('该拼团活动未开放');
      }
      this.assertOfferEligible(campaign.offer);
      const activeSlot = standardPlanPurchaseKey(userId);
      const existing = await tx.groupBuyMember.findFirst({
        where: {
          userId,
          activeSlot: { not: null },
          status: {
            in: [
              GroupBuyMemberStatus.PAYMENT_PENDING,
              GroupBuyMemberStatus.PAID,
              GroupBuyMemberStatus.FULFILLED,
            ],
          },
        },
        include: { group: true, paymentAttempt: true },
      });
      if (existing) {
        if (existing.group.campaignId !== campaign.id) {
          throw new ConflictException('你已有进行中的套餐拼团');
        }
        const prepared = this.prepared(
          existing.group,
          existing,
          campaign.offer,
        );
        this.assertActivationPreference(
          prepared.snapshot,
          planActivation,
          Boolean(existing.paymentAttempt),
        );
        return prepared;
      }
      const planPolicy = await this.resolveMemberPlanPurchasePolicy(
        tx,
        userId,
        campaign.offer,
        planActivation,
        now,
      );

      const groupId = randomUUID();
      const memberId = randomUUID();
      const priceCents = discountedPriceCents(
        campaign.offer.priceCents,
        campaign.discountBasisPoints,
      );
      const baseSnapshot = snapshotCatalogOffer(campaign.offer, {
        purchaseMode: 'initial',
        groupBuyId: groupId,
        groupBuyBonusBytes: campaign.bonusTrafficBytes.toString(),
        groupBuyOriginalPriceCents: campaign.offer.priceCents,
        groupBuyPriceCents: priceCents,
        groupBuyDiscountBasisPoints: campaign.discountBasisPoints,
        groupBuySettlementMode: BALANCE_REBATE_MODE,
      });
      const group = await tx.groupBuy.create({
        data: {
          id: groupId,
          campaignId: campaign.id,
          creatorId: userId,
          shareCode: this.shareCode(),
          offerIdSnapshot: campaign.offer.id,
          productNameSnapshot: campaign.offer.product.name,
          offerNameSnapshot: campaign.offer.name,
          priceCentsSnapshot: priceCents,
          currencySnapshot: campaign.offer.currency,
          requiredMembersSnapshot: campaign.requiredMembers,
          discountBasisPointsSnapshot: campaign.discountBasisPoints,
          bonusTrafficBytesSnapshot: campaign.bonusTrafficBytes,
          settlementModeSnapshot: BALANCE_REBATE_MODE,
          entitlementSnapshot: baseSnapshot as unknown as Prisma.InputJsonValue,
        },
      });
      const member = await tx.groupBuyMember.create({
        data: {
          id: memberId,
          groupId,
          userId,
          isCreator: true,
          activeSlot,
          entitlementSnapshot: this.memberEntitlementSnapshot(
            baseSnapshot,
            {
              id: groupId,
              priceCentsSnapshot: priceCents,
              discountBasisPointsSnapshot: campaign.discountBasisPoints,
              bonusTrafficBytesSnapshot: campaign.bonusTrafficBytes,
              settlementModeSnapshot: BALANCE_REBATE_MODE,
            },
            memberId,
            planPolicy,
            planActivation,
          ) as unknown as Prisma.InputJsonValue,
        },
        include: { paymentAttempt: true },
      });
      return this.prepared(group, member, campaign.offer);
    }

    const group = await tx.groupBuy.findUnique({
      where: { id: mode.groupId },
      include: { members: true },
    });
    if (
      !group ||
      group.status !== GroupBuyStatus.OPEN ||
      !group.expiresAt ||
      group.expiresAt <= now
    ) {
      throw new BadRequestException('该拼团当前无法加入');
    }
    const previousMember = group.members.find(
      (member) => member.userId === userId,
    );
    if (previousMember) {
      if (previousMember.status !== GroupBuyMemberStatus.PAYMENT_CLOSED) {
        throw new ConflictException('不能重复加入同一个拼团');
      }
      const otherActive = await tx.groupBuyMember.findFirst({
        where: {
          userId,
          id: { not: previousMember.id },
          activeSlot: { not: null },
          status: {
            in: [
              GroupBuyMemberStatus.PAYMENT_PENDING,
              GroupBuyMemberStatus.PAID,
              GroupBuyMemberStatus.FULFILLED,
            ],
          },
        },
      });
      if (otherActive) {
        throw new ConflictException('你已有进行中的套餐拼团');
      }
      const offer = await this.snapshotOffer(tx, group);
      const planPolicy = await this.resolveMemberPlanPurchasePolicy(
        tx,
        userId,
        offer,
        planActivation,
        now,
      );
      const entitlementSnapshot = this.memberEntitlementSnapshot(
        parseCatalogOfferSnapshot(group.entitlementSnapshot),
        group,
        previousMember.id,
        planPolicy,
        planActivation,
      );
      const reactivated = await tx.groupBuyMember.update({
        where: { id: previousMember.id },
        data: {
          status: GroupBuyMemberStatus.PAYMENT_PENDING,
          activeSlot: standardPlanPurchaseKey(userId),
          paymentAttemptId: null,
          entitlementSnapshot:
            entitlementSnapshot as unknown as Prisma.InputJsonValue,
        },
        include: { paymentAttempt: true },
      });
      return this.prepared(group, reactivated, offer);
    }
    const activeSlot = standardPlanPurchaseKey(userId);
    const active = await tx.groupBuyMember.findFirst({
      where: {
        userId,
        activeSlot: { not: null },
        status: {
          in: [
            GroupBuyMemberStatus.PAYMENT_PENDING,
            GroupBuyMemberStatus.PAID,
            GroupBuyMemberStatus.FULFILLED,
          ],
        },
      },
      include: { group: true, paymentAttempt: true },
    });
    if (active) {
      if (active.groupId !== group.id) {
        throw new ConflictException('你已参加该套餐的其他拼团');
      }
      const offer = await this.snapshotOffer(tx, active.group);
      const prepared = this.prepared(active.group, active, offer);
      this.assertActivationPreference(
        prepared.snapshot,
        planActivation,
        Boolean(active.paymentAttempt),
      );
      return prepared;
    }
    const occupiedStatuses = new Set<GroupBuyMemberStatus>([
      GroupBuyMemberStatus.PAYMENT_PENDING,
      GroupBuyMemberStatus.PAID,
      GroupBuyMemberStatus.FULFILLED,
    ]);
    const occupied = group.members.filter((member) =>
      occupiedStatuses.has(member.status),
    ).length;
    if (occupied >= group.requiredMembersSnapshot) {
      throw new ConflictException('该拼团已有成员正在付款');
    }
    const offer = await this.snapshotOffer(tx, group);
    const planPolicy = await this.resolveMemberPlanPurchasePolicy(
      tx,
      userId,
      offer,
      planActivation,
      now,
    );
    const memberId = randomUUID();
    const member = await tx.groupBuyMember.create({
      data: {
        id: memberId,
        groupId: group.id,
        userId,
        activeSlot,
        entitlementSnapshot: this.memberEntitlementSnapshot(
          parseCatalogOfferSnapshot(group.entitlementSnapshot),
          group,
          memberId,
          planPolicy,
          planActivation,
        ) as unknown as Prisma.InputJsonValue,
      },
      include: { paymentAttempt: true },
    });
    return this.prepared(group, member, offer);
  }

  attachPayment(
    tx: Prisma.TransactionClient,
    memberId: string,
    paymentAttemptId: string,
  ) {
    return tx.groupBuyMember.update({
      where: { id: memberId },
      data: { paymentAttemptId },
    });
  }

  async purchaseWithWallet(
    userId: string,
    mode: GroupBuyPaymentMode,
    idempotencyKey: string,
    planActivation?: PlanActivationPreference,
  ) {
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey || normalizedKey.length > 120) {
      throw new BadRequestException('A valid Idempotency-Key is required');
    }
    for (let retry = 0; retry < 3; retry += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const replay = await tx.groupBuyMember.findUnique({
              where: {
                userId_walletIdempotencyKey: {
                  userId,
                  walletIdempotencyKey: normalizedKey,
                },
              },
              include: { group: true, order: true },
            });
            if (replay) {
              this.assertWalletReplayMatches(replay.group, mode);
              this.assertActivationPreference(
                parseCatalogOfferSnapshot(replay.entitlementSnapshot),
                planActivation,
                true,
              );
              if (!replay.order) {
                throw new ConflictException('余额支付正在处理中，请稍后重试');
              }
              return this.presentWalletPayment(
                replay,
                replay.group,
                replay.order.id,
              );
            }

            const now = new Date();
            await this.paymentAttempts?.abandonPendingPayments(tx, userId, now);
            const prepared = await this.preparePayment(
              tx,
              userId,
              mode,
              now,
              planActivation,
            );
            if (prepared.group.settlementModeSnapshot !== BALANCE_REBATE_MODE) {
              throw new BadRequestException('该历史拼团不支持余额支付');
            }
            if (prepared.existingAttempt) {
              throw new ConflictException('该拼团已有待处理的在线支付订单');
            }
            if (
              prepared.member.walletIdempotencyKey &&
              prepared.member.walletIdempotencyKey !== normalizedKey
            ) {
              throw new ConflictException('该拼团成员已有余额支付订单');
            }
            await tx.groupBuyMember.update({
              where: { id: prepared.member.id },
              data: { walletIdempotencyKey: normalizedKey },
            });
            const amountCents =
              prepared.snapshot.groupBuyOriginalPriceCents ??
              prepared.group.priceCentsSnapshot;
            const result = await this.commerce.fulfillGroupBuyWalletPayment(
              tx,
              {
                userId,
                offerId: prepared.group.offerIdSnapshot,
                memberId: prepared.member.id,
                amountCents,
                basePriceCents: amountCents,
                entitlementSnapshot: prepared.snapshot,
                paidAt: now,
              },
            );
            await this.markBalanceRebateMemberFulfilled(
              tx,
              prepared.member.id,
              result.orderId,
              now,
            );
            await this.advanceBalanceRebateGroup(
              tx,
              prepared.group.id,
              prepared.member.isCreator,
              now,
            );
            const currentGroup = await tx.groupBuy.findUniqueOrThrow({
              where: { id: prepared.group.id },
            });
            return this.presentWalletPayment(
              { ...prepared.member, paidAt: now },
              currentGroup,
              result.orderId,
            );
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (this.isRetryableTransactionError(error) && retry < 2) continue;
        throw error;
      }
    }
    throw new ConflictException('余额支付冲突，请重试');
  }

  async settleVerifiedPayment(
    tx: Prisma.TransactionClient,
    attempt: EpayPaymentAttempt,
    input: EpaySettlementInput,
    snapshot: CatalogOfferSnapshot,
  ) {
    const member = await tx.groupBuyMember.findUnique({
      where: { id: snapshot.groupBuyMemberId! },
      include: {
        group: true,
        paymentAttempt: true,
      },
    });
    if (
      !member ||
      member.groupId !== snapshot.groupBuyId ||
      member.userId !== attempt.userId
    ) {
      throw new ConflictException('拼团支付关联无效');
    }
    if (member.orderId || member.status === GroupBuyMemberStatus.FULFILLED) {
      if (member.paymentAttemptId === attempt.id) return attempt;
      throw new PaymentFulfillmentRejectedError(
        'DUPLICATE_GROUP_PAYMENT',
        '该拼团成员已经通过另一笔付款完成履约',
      );
    }
    if (member.paymentAttemptId !== attempt.id) {
      if (member.paymentAttemptId) {
        await tx.epayPaymentAttempt.updateMany({
          where: {
            id: member.paymentAttemptId,
            status: EpayPaymentStatus.PENDING,
          },
          data: {
            status: EpayPaymentStatus.EXPIRED,
            activeKey: null,
            closedAt: input.paidAt,
          },
        });
      }
      await tx.groupBuyMember.update({
        where: { id: member.id },
        data: { paymentAttemptId: attempt.id },
      });
    }
    const paidAttempt = await tx.epayPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        gatewayTradeNo: input.gatewayTradeNo,
        status: EpayPaymentStatus.SETTLED,
        fulfillmentStatus:
          member.group.settlementModeSnapshot === BALANCE_REBATE_MODE
            ? PaymentFulfillmentStatus.APPLIED
            : PaymentFulfillmentStatus.PENDING,
        activeKey: null,
        settledAt: input.paidAt,
        failedAt: null,
        closedAt: null,
        lastSettlementError: null,
        lastSettlementFailedAt: null,
        lastQueryError: null,
      },
    });
    await tx.groupBuyMember.update({
      where: { id: member.id },
      data: { status: GroupBuyMemberStatus.PAID, paidAt: input.paidAt },
    });

    if (member.group.settlementModeSnapshot === BALANCE_REBATE_MODE) {
      const result = await this.commerce.fulfillEpayPayment(tx, {
        ...input,
        entitlementStartsAt: input.paidAt,
      });
      await this.markBalanceRebateMemberFulfilled(
        tx,
        member.id,
        result.orderId,
        input.paidAt,
        paidAttempt.id,
      );
      await this.advanceBalanceRebateGroup(
        tx,
        member.groupId,
        member.isCreator,
        input.paidAt,
      );
      return tx.epayPaymentAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
    }

    if (
      member.isCreator &&
      member.group.status === GroupBuyStatus.PENDING_PAYMENT
    ) {
      await tx.groupBuy.update({
        where: { id: member.groupId },
        data: {
          status: GroupBuyStatus.OPEN,
          openedAt: input.paidAt,
          expiresAt: new Date(input.paidAt.getTime() + GROUP_DURATION_MS),
        },
      });
      return paidAttempt;
    }

    if (
      !member.group.expiresAt ||
      member.group.expiresAt <= input.paidAt ||
      member.group.status !== GroupBuyStatus.OPEN
    ) {
      await this.markGroupForRefund(tx, member.groupId, input.paidAt);
      return paidAttempt;
    }
    await this.fulfillGroup(tx, member.groupId, input.paidAt);
    return tx.epayPaymentAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
  }

  async closePayment(tx: Prisma.TransactionClient, paymentAttemptId: string) {
    const member = await tx.groupBuyMember.findUnique({
      where: { paymentAttemptId },
      include: { group: true },
    });
    if (!member || member.status !== GroupBuyMemberStatus.PAYMENT_PENDING)
      return;
    await tx.groupBuyMember.update({
      where: { id: member.id },
      data: {
        status: GroupBuyMemberStatus.PAYMENT_CLOSED,
        activeSlot: null,
      },
    });
    if (
      member.isCreator &&
      member.group.status === GroupBuyStatus.PENDING_PAYMENT
    ) {
      await tx.groupBuy.update({
        where: { id: member.groupId },
        data: { status: GroupBuyStatus.CANCELED, completedAt: new Date() },
      });
    }
  }

  async expireDueGroups(now = new Date()) {
    const groups = await this.prisma.groupBuy.findMany({
      where: { status: GroupBuyStatus.OPEN, expiresAt: { lte: now } },
      select: { id: true },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: 20,
    });
    for (const group of groups) {
      await this.prisma.$transaction(
        (tx) => this.markGroupForRefund(tx, group.id, now),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    }
    return groups.length;
  }

  async fallbackFulfillMember(memberId: string, now = new Date()) {
    return this.prisma.$transaction(
      async (tx) => {
        const member = await tx.groupBuyMember.findUnique({
          where: { id: memberId },
          include: {
            group: true,
            paymentAttempt: true,
            refundAttempt: true,
          },
        });
        if (!member?.paymentAttempt || member.orderId) return null;
        if (
          !member.refundAttempt?.fallbackAllowedAt ||
          !new Set<GroupBuyMemberStatus>([
            GroupBuyMemberStatus.REFUND_PENDING,
            GroupBuyMemberStatus.EXCEPTION,
          ]).has(member.status)
        ) {
          throw new ConflictException('该成员当前不需要兜底发放');
        }
        const result = await this.fulfillMember(
          tx,
          member,
          member.paymentAttempt,
          now,
          false,
        );
        await this.refreshRefundingGroupStatus(tx, member.groupId, now);
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async refreshRefundingGroupStatus(
    tx: Prisma.TransactionClient,
    groupId: string,
    now = new Date(),
  ) {
    const group = await tx.groupBuy.findUnique({
      where: { id: groupId },
      include: {
        members: {
          include: { paymentAttempt: { select: { status: true } } },
        },
      },
    });
    if (!group) return;
    const paidMembers = group.members.filter(
      (member) => member.paymentAttempt?.status === EpayPaymentStatus.SETTLED,
    );
    const terminal = new Set<GroupBuyMemberStatus>([
      GroupBuyMemberStatus.REFUNDED,
      GroupBuyMemberStatus.FALLBACK_FULFILLED,
      GroupBuyMemberStatus.FULFILLED,
    ]);
    if (
      !paidMembers.length ||
      paidMembers.some((member) => !terminal.has(member.status))
    ) {
      return;
    }
    const usedFallback = paidMembers.some(
      (member) => member.status === GroupBuyMemberStatus.FALLBACK_FULFILLED,
    );
    await tx.groupBuy.update({
      where: { id: groupId },
      data: {
        status: usedFallback
          ? GroupBuyStatus.FALLBACK_FULFILLED
          : GroupBuyStatus.REFUNDED,
        completedAt: now,
      },
    });
  }

  async reverseBonusForRefund(
    tx: Prisma.TransactionClient,
    orderId: string,
    actorId: string,
    refundId: string,
  ) {
    const member = await tx.groupBuyMember.findUnique({
      where: { orderId },
      include: {
        bonusEntitlementGrant: { include: { quotaBuckets: true } },
        rebateWalletLedger: true,
      },
    });
    const grant = member?.bonusEntitlementGrant;
    if (!member) {
      return { reversed: false } as const;
    }
    const now = new Date();
    const bonusReversed = grant
      ? (
          await this.entitlements.revokeGrant(tx, {
            grantId: grant.id,
            at: now,
            actorId,
            reason: `拼团订单全额退款 ${refundId}`,
            auditAction: 'group_buy.bonus_revoked',
          })
        ).revoked
      : false;

    const grossRebateCents = Math.max(
      0,
      member.rebateWalletLedger?.amountCents ?? 0,
    );
    const reversalKey = `group-buy:${member.id}:rebate-reversal`;
    const existingReversal = await tx.walletLedgerEntry.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: member.userId,
          idempotencyKey: reversalKey,
        },
      },
      select: { amountCents: true },
    });
    const refundRecoveredCents = Math.max(
      0,
      -(existingReversal?.amountCents ?? 0),
    );
    const correctionRecoveredCents = Math.min(
      grossRebateCents,
      Math.max(0, member.rebateRecoveredCents - refundRecoveredCents),
    );
    const rebateCents = remainingRebateCents(
      grossRebateCents,
      correctionRecoveredCents,
    );
    let recoveredCents = 0;
    let unrecoveredCents = 0;
    if (rebateCents > 0) {
      const recovery = await recoverWalletCredit(tx, {
        userId: member.userId,
        actorId,
        orderId,
        requestedCents: rebateCents,
        kind: 'ADJUST',
        idempotencyKey: reversalKey,
        note: `拼团返现退款追回 ${refundId}`,
      });
      recoveredCents = recovery.recoveredCents;
      unrecoveredCents = recovery.unrecoveredCents;
    }
    if (!bonusReversed && rebateCents === 0) {
      return { reversed: false } as const;
    }
    await tx.groupBuyMember.update({
      where: { id: member.id },
      data: {
        rebateRecoveredCents: correctionRecoveredCents + recoveredCents,
        rebateUnrecoveredCents: unrecoveredCents,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'group_buy.rewards_reversed',
        targetType: 'group_buy_member',
        targetId: member.id,
        metadata: {
          orderId,
          refundId,
          grantId: grant?.id ?? null,
          bonusReversed,
          grossRebateCents,
          correctionRecoveredCents,
          rebateCents,
          recoveredCents,
          unrecoveredCents,
        },
      },
    });
    return { reversed: true } as const;
  }

  private async fulfillGroup(
    tx: Prisma.TransactionClient,
    groupId: string,
    fulfilledAt: Date,
  ) {
    const group = await tx.groupBuy.findUnique({
      where: { id: groupId },
      include: {
        members: {
          where: { status: GroupBuyMemberStatus.PAID },
          include: { paymentAttempt: true },
          orderBy: [{ isCreator: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!group || group.members.length < group.requiredMembersSnapshot) return;
    await tx.groupBuy.update({
      where: { id: group.id },
      data: { status: GroupBuyStatus.FULFILLING },
    });
    for (const member of group.members.slice(
      0,
      group.requiredMembersSnapshot,
    )) {
      if (!member.paymentAttempt)
        throw new ConflictException('拼团付款记录缺失');
      await this.fulfillMember(
        tx,
        member,
        member.paymentAttempt,
        fulfilledAt,
        true,
        group.bonusTrafficBytesSnapshot,
      );
    }
    await tx.groupBuy.update({
      where: { id: group.id },
      data: { status: GroupBuyStatus.SUCCEEDED, completedAt: fulfilledAt },
    });
  }

  private async advanceBalanceRebateGroup(
    tx: Prisma.TransactionClient,
    groupId: string,
    isCreator: boolean,
    paidAt: Date,
  ) {
    const group = await tx.groupBuy.findUnique({ where: { id: groupId } });
    if (!group) throw new ConflictException('拼团不存在');
    if (isCreator) {
      if (group.status === GroupBuyStatus.PENDING_PAYMENT) {
        await tx.groupBuy.update({
          where: { id: groupId },
          data: {
            status: GroupBuyStatus.OPEN,
            openedAt: paidAt,
            expiresAt: new Date(paidAt.getTime() + GROUP_DURATION_MS),
          },
        });
      }
      return;
    }
    if (
      group.status !== GroupBuyStatus.OPEN ||
      !group.expiresAt ||
      group.expiresAt <= paidAt
    ) {
      await this.finalizeUnsuccessfulBalanceRebateGroup(tx, groupId, paidAt);
      return;
    }
    await this.fulfillBalanceRebateGroup(tx, groupId, paidAt);
  }

  private async fulfillBalanceRebateGroup(
    tx: Prisma.TransactionClient,
    groupId: string,
    fulfilledAt: Date,
  ) {
    const group = await tx.groupBuy.findUnique({
      where: { id: groupId },
      include: {
        members: {
          where: {
            status: GroupBuyMemberStatus.FULFILLED,
            orderId: { not: null },
          },
          orderBy: [{ isCreator: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (
      !group ||
      group.settlementModeSnapshot !== BALANCE_REBATE_MODE ||
      group.members.length < group.requiredMembersSnapshot
    ) {
      return;
    }
    const claimed = await tx.groupBuy.updateMany({
      where: { id: group.id, status: GroupBuyStatus.OPEN },
      data: { status: GroupBuyStatus.FULFILLING },
    });
    if (claimed.count !== 1) return;

    for (const member of group.members.slice(
      0,
      group.requiredMembersSnapshot,
    )) {
      let bonusEntitlementGrantId = member.bonusEntitlementGrantId;
      if (!bonusEntitlementGrantId && group.bonusTrafficBytesSnapshot > 0n) {
        bonusEntitlementGrantId = await this.createBonusGrant(
          tx,
          member.userId,
          member.orderId!,
          fulfilledAt,
          group.bonusTrafficBytesSnapshot,
        );
      }
      const rebateWalletLedgerId =
        member.rebateWalletLedgerId ??
        (await this.creditBalanceRebate(
          tx,
          member.id,
          member.userId,
          member.orderId!,
          Math.max(
            0,
            (parseCatalogOfferSnapshot(group.entitlementSnapshot)
              ?.groupBuyOriginalPriceCents ?? group.priceCentsSnapshot) -
              group.priceCentsSnapshot,
          ),
        ));
      await tx.groupBuyMember.update({
        where: { id: member.id },
        data: {
          bonusEntitlementGrantId,
          rebateWalletLedgerId,
          activeSlot: null,
        },
      });
    }
    await tx.groupBuy.update({
      where: { id: group.id },
      data: { status: GroupBuyStatus.SUCCEEDED, completedAt: fulfilledAt },
    });
  }

  private async creditBalanceRebate(
    tx: Prisma.TransactionClient,
    memberId: string,
    userId: string,
    orderId: string,
    rebateCents: number,
  ) {
    if (rebateCents <= 0) return null;
    const idempotencyKey = `group-buy:${memberId}:rebate`;
    const posting = await postWalletEntry(tx, {
      userId,
      orderId,
      amountCents: rebateCents,
      kind: 'REFUND',
      idempotencyKey,
      note: '拼团成功返还优惠差额',
    });
    await tx.auditLog.create({
      data: {
        action: 'group_buy.balance_rebate_settled',
        targetType: 'group_buy_member',
        targetId: memberId,
        metadata: {
          userId,
          orderId,
          rebateCents,
          walletLedgerId: posting.ledgerId,
        },
      },
    });
    return posting.ledgerId;
  }

  private async markBalanceRebateMemberFulfilled(
    tx: Prisma.TransactionClient,
    memberId: string,
    orderId: string,
    paidAt: Date,
    paymentAttemptId?: string,
  ) {
    await tx.groupBuyMember.update({
      where: { id: memberId },
      data: {
        status: GroupBuyMemberStatus.FULFILLED,
        orderId,
        paidAt,
        fulfilledAt: paidAt,
      },
    });
    if (paymentAttemptId) {
      await tx.epayPaymentAttempt.update({
        where: { id: paymentAttemptId },
        data: {
          orderId,
          fulfillmentStatus: PaymentFulfillmentStatus.APPLIED,
        },
      });
    }
  }

  private async fulfillMember(
    tx: Prisma.TransactionClient,
    member: { id: string; userId: string; groupId: string },
    attempt: EpayPaymentAttempt,
    fulfilledAt: Date,
    includeBonus: boolean,
    bonusTrafficBytes = 0n,
  ) {
    if (!attempt.gatewayTradeNo || !attempt.settledAt) {
      throw new ConflictException('拼团付款尚未结算');
    }
    const result = await this.commerce.fulfillEpayPayment(tx, {
      attemptId: attempt.id,
      userId: attempt.userId,
      offerId: attempt.offerId,
      merchantOrderNo: attempt.merchantOrderNo,
      gatewayTradeNo: attempt.gatewayTradeNo,
      amountCents: attempt.amountCents,
      basePriceCents: attempt.basePriceCents,
      entitlementSnapshot: attempt.entitlementSnapshot,
      paidAt: attempt.settledAt,
      entitlementStartsAt: fulfilledAt,
    });
    let bonusEntitlementGrantId: string | null = null;
    if (includeBonus && bonusTrafficBytes > 0n) {
      bonusEntitlementGrantId = await this.createBonusGrant(
        tx,
        member.userId,
        result.orderId,
        fulfilledAt,
        bonusTrafficBytes,
      );
    }
    await tx.groupBuyMember.update({
      where: { id: member.id },
      data: {
        status: includeBonus
          ? GroupBuyMemberStatus.FULFILLED
          : GroupBuyMemberStatus.FALLBACK_FULFILLED,
        orderId: result.orderId,
        bonusEntitlementGrantId,
        fulfilledAt,
        activeSlot: null,
      },
    });
    await tx.epayPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        orderId: result.orderId,
        fulfillmentStatus: PaymentFulfillmentStatus.APPLIED,
      },
    });
    return result;
  }

  private async createBonusGrant(
    tx: Prisma.TransactionClient,
    userId: string,
    orderId: string,
    startsAt: Date,
    bonusTrafficBytes: bigint,
  ) {
    const bonus = await this.entitlements.createBonusTrafficGrantFromOrder(tx, {
      orderId,
      userId,
      productId: GROUP_BONUS_PRODUCT_ID,
      startsAt,
      bytes: bonusTrafficBytes,
    });
    return bonus.grantId;
  }

  private async markGroupForRefund(
    tx: Prisma.TransactionClient,
    groupId: string,
    now: Date,
  ) {
    const group = await tx.groupBuy.findUnique({
      where: { id: groupId },
      include: {
        members: { include: { paymentAttempt: true } },
      },
    });
    if (group?.settlementModeSnapshot === BALANCE_REBATE_MODE) {
      await this.finalizeUnsuccessfulBalanceRebateGroup(tx, groupId, now);
      return;
    }
    if (
      !group ||
      !new Set<GroupBuyStatus>([
        GroupBuyStatus.OPEN,
        GroupBuyStatus.REFUNDING,
      ]).has(group.status)
    ) {
      return;
    }
    const paid = group.members.filter(
      (member) =>
        member.paymentAttempt?.status === EpayPaymentStatus.SETTLED &&
        !member.orderId,
    );
    for (const member of paid) {
      await tx.groupBuyMember.update({
        where: { id: member.id },
        data: { status: GroupBuyMemberStatus.REFUND_PENDING },
      });
      await tx.epayRefundAttempt.upsert({
        where: { paymentAttemptId: member.paymentAttemptId! },
        create: {
          paymentAttemptId: member.paymentAttemptId!,
          groupBuyMemberId: member.id,
          amountCents: member.paymentAttempt!.amountCents,
          reasonCode: 'GROUP_BUY_EXPIRED',
        },
        update: {},
      });
      await tx.epayPaymentAttempt.update({
        where: { id: member.paymentAttemptId! },
        data: { fulfillmentStatus: PaymentFulfillmentStatus.REFUND_PENDING },
      });
    }
    await tx.groupBuy.update({
      where: { id: group.id },
      data: {
        status: paid.length
          ? GroupBuyStatus.REFUNDING
          : GroupBuyStatus.CANCELED,
        completedAt: paid.length ? null : now,
      },
    });
  }

  private async finalizeUnsuccessfulBalanceRebateGroup(
    tx: Prisma.TransactionClient,
    groupId: string,
    completedAt: Date,
  ) {
    const group = await tx.groupBuy.findUnique({
      where: { id: groupId },
      include: { members: true },
    });
    if (
      !group ||
      group.settlementModeSnapshot !== BALANCE_REBATE_MODE ||
      group.status === GroupBuyStatus.SUCCEEDED
    ) {
      return;
    }
    const fulfilled = group.members.filter((member) => member.orderId);
    await tx.groupBuyMember.updateMany({
      where: {
        groupId,
        orderId: { not: null },
        rebateWalletLedgerId: null,
        bonusEntitlementGrantId: null,
      },
      data: {
        status: GroupBuyMemberStatus.FALLBACK_FULFILLED,
        activeSlot: null,
      },
    });
    await tx.groupBuyMember.updateMany({
      where: { groupId, orderId: null },
      data: { activeSlot: null },
    });
    await tx.groupBuy.update({
      where: { id: groupId },
      data: {
        status: fulfilled.length
          ? GroupBuyStatus.FALLBACK_FULFILLED
          : GroupBuyStatus.CANCELED,
        completedAt,
      },
    });
    await tx.auditLog.create({
      data: {
        action: 'group_buy.completed_without_rewards',
        targetType: 'group_buy',
        targetId: groupId,
        metadata: {
          fulfilledMembers: fulfilled.length,
          retainedOriginalPriceEntitlements: true,
        },
      },
    });
  }

  private async resolveMemberPlanPurchasePolicy(
    tx: Prisma.TransactionClient,
    userId: string,
    offer: Prisma.CatalogOfferGetPayload<{
      include: typeof catalogOfferSnapshotInclude;
    }>,
    preference: PlanActivationPreference | undefined,
    now: Date,
  ): Promise<PlanPurchasePolicy> {
    const legacyPlanId = offer.product.legacyPlanId;
    if (!legacyPlanId) {
      throw new BadRequestException('拼团套餐缺少兼容套餐配置');
    }
    const [currentPlan, scheduledPlan, pendingPayment] = await Promise.all([
      tx.subscription.findFirst({
        where: {
          userId,
          status: { in: ['ACTIVE', 'PAUSED'] },
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
        include: { plan: { include: { catalogProduct: true } } },
        orderBy: [{ endsAt: 'desc' }, { createdAt: 'desc' }],
      }),
      tx.subscription.findFirst({
        where: {
          userId,
          status: { in: ['ACTIVE', 'PAUSED'] },
          startsAt: { gt: now },
          endsAt: { gt: now },
        },
        select: { id: true },
      }),
      tx.epayPaymentAttempt.findUnique({
        where: { activeKey: standardPlanPurchaseKey(userId) },
        select: { id: true },
      }),
    ]);
    if (scheduledPlan) {
      throw new ConflictException(
        '已有预约生效的套餐，当前仅可重置本期流量，请等待切换后再续费、换套餐或参加拼团',
      );
    }
    if (pendingPayment) {
      throw new ConflictException('已有待支付的套餐订单，请先完成或关闭');
    }
    return decidePlanPurchasePolicy({
      now,
      targetProductId: offer.product.id,
      targetLegacyPlanId: legacyPlanId,
      preference,
      currentPlan: currentPlan
        ? {
            productId: currentPlan.plan.catalogProduct?.id ?? null,
            productName:
              currentPlan.plan.catalogProduct?.name ?? currentPlan.plan.name,
            legacyPlanId: currentPlan.planId,
            startsAt: currentPlan.startsAt,
            endsAt: currentPlan.endsAt,
          }
        : null,
    });
  }

  private memberEntitlementSnapshot(
    base: CatalogOfferSnapshot | null,
    group: {
      id: string;
      priceCentsSnapshot: number;
      discountBasisPointsSnapshot: number;
      bonusTrafficBytesSnapshot: bigint;
      settlementModeSnapshot: GroupBuySettlementMode;
    },
    memberId: string,
    policy: PlanPurchasePolicy,
    preference?: PlanActivationPreference,
  ): CatalogOfferSnapshot {
    if (!base) throw new ConflictException('拼团商品快照缺失');
    const isSwitch =
      policy.mode === 'scheduled_switch' || policy.mode === 'immediate_switch';
    return {
      ...base,
      purchaseMode: 'group_buy',
      groupBuyId: group.id,
      groupBuyMemberId: memberId,
      groupBuyBonusBytes: group.bonusTrafficBytesSnapshot.toString(),
      groupBuyPriceCents: group.priceCentsSnapshot,
      groupBuyDiscountBasisPoints: group.discountBasisPointsSnapshot,
      groupBuySettlementMode: group.settlementModeSnapshot,
      planActivationPreference: isSwitch
        ? (preference ?? 'scheduled_switch')
        : null,
      planActivationMode: policy.mode,
      planEffectiveAt: policy.effectiveAt.toISOString(),
      currentPlanProductId: policy.currentPlan?.productId ?? null,
      currentPlanName: policy.currentPlan?.productName ?? null,
      currentPlanEndsAt: policy.currentPlan?.endsAt.toISOString() ?? null,
    };
  }

  private assertActivationPreference(
    snapshot: CatalogOfferSnapshot | null,
    preference: PlanActivationPreference | undefined,
    frozen: boolean,
  ) {
    if (!frozen || !snapshot) return;
    if (
      snapshot.planActivationMode !== 'scheduled_switch' &&
      snapshot.planActivationMode !== 'immediate_switch'
    ) {
      return;
    }
    const requested = preference ?? 'scheduled_switch';
    if (snapshot.planActivationPreference !== requested) {
      throw new ConflictException(
        '该拼团付款已锁定其他套餐生效方式，请完成或关闭原支付单后重试',
      );
    }
  }

  private prepared(
    group: {
      id: string;
      offerIdSnapshot: string;
      priceCentsSnapshot: number;
      currencySnapshot: string;
      discountBasisPointsSnapshot: number;
      bonusTrafficBytesSnapshot: bigint;
      settlementModeSnapshot: GroupBuySettlementMode;
      entitlementSnapshot: Prisma.JsonValue;
      expiresAt: Date | null;
    },
    member: {
      id: string;
      isCreator: boolean;
      orderId: string | null;
      walletIdempotencyKey: string | null;
      entitlementSnapshot: Prisma.JsonValue | null;
      paymentAttempt: EpayPaymentAttempt | null;
    },
    offer: Prisma.CatalogOfferGetPayload<{
      include: typeof catalogOfferSnapshotInclude;
    }>,
  ) {
    const base = parseCatalogOfferSnapshot(
      member.paymentAttempt?.entitlementSnapshot ??
        member.entitlementSnapshot ??
        group.entitlementSnapshot,
    );
    if (!base) throw new ConflictException('拼团商品快照缺失');
    return {
      group,
      member,
      offer,
      existingAttempt: member.paymentAttempt,
      snapshot: {
        ...base,
        purchaseMode: 'group_buy' as const,
        groupBuyId: group.id,
        groupBuyMemberId: member.id,
        groupBuyBonusBytes: group.bonusTrafficBytesSnapshot.toString(),
        groupBuyPriceCents: group.priceCentsSnapshot,
        groupBuyDiscountBasisPoints: group.discountBasisPointsSnapshot,
        groupBuySettlementMode: group.settlementModeSnapshot,
      },
    };
  }

  private assertWalletReplayMatches(
    group: { id: string; campaignId: string },
    mode: GroupBuyPaymentMode,
  ) {
    const matches =
      mode.kind === 'create'
        ? group.campaignId === mode.campaignId
        : group.id === mode.groupId;
    if (!matches) {
      throw new ConflictException(
        'Idempotency-Key was already used for another purchase',
      );
    }
  }

  private presentWalletPayment(
    member: {
      id: string;
      paidAt: Date | null;
      entitlementSnapshot: Prisma.JsonValue | null;
    },
    group: {
      productNameSnapshot: string;
      offerNameSnapshot: string;
      priceCentsSnapshot: number;
      entitlementSnapshot: Prisma.JsonValue;
      expiresAt: Date | null;
    },
    orderId: string,
  ) {
    const snapshot = parseCatalogOfferSnapshot(
      member.entitlementSnapshot ?? group.entitlementSnapshot,
    );
    return {
      id: `balance:${member.id}`,
      status: 'settled' as const,
      paymentType: 'balance' as const,
      amountCents:
        snapshot?.groupBuyOriginalPriceCents ?? group.priceCentsSnapshot,
      productName: `${group.productNameSnapshot} · ${group.offerNameSnapshot} · 拼团`,
      expiresAt: (group.expiresAt ?? member.paidAt ?? new Date()).toISOString(),
      orderId,
      planActivationMode: snapshot?.planActivationMode ?? null,
      planEffectiveAt: snapshot?.planEffectiveAt ?? null,
    };
  }

  private isRetryableTransactionError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2034' || error.code === 'P2002')
    );
  }

  private async snapshotOffer(
    tx: Prisma.TransactionClient,
    group: { offerIdSnapshot: string },
  ) {
    const offer = await tx.catalogOffer.findUnique({
      where: { id: group.offerIdSnapshot },
      include: catalogOfferSnapshotInclude,
    });
    if (!offer) throw new ConflictException('拼团商品已不存在');
    return offer;
  }

  private assertOfferEligible(
    offer: Prisma.CatalogOfferGetPayload<{
      include: typeof catalogOfferSnapshotInclude;
    }>,
  ) {
    if (
      !offer.active ||
      offer.archivedAt ||
      offer.product.status !== CatalogProductStatus.ACTIVE ||
      offer.product.kind !== CatalogProductKind.PLAN ||
      offer.product.series !== CatalogProductSeries.STANDARD ||
      offer.product.slug === 'go'
    ) {
      throw new BadRequestException('该套餐不能参加拼团');
    }
    snapshotCatalogOffer(offer);
  }

  private presentGroup(
    group: {
      id: string;
      creatorId: string;
      shareCode: string;
      status: GroupBuyStatus;
      productNameSnapshot: string;
      offerNameSnapshot: string;
      priceCentsSnapshot: number;
      currencySnapshot: string;
      discountBasisPointsSnapshot: number;
      bonusTrafficBytesSnapshot: bigint;
      settlementModeSnapshot: GroupBuySettlementMode;
      entitlementSnapshot: Prisma.JsonValue;
      requiredMembersSnapshot: number;
      openedAt: Date | null;
      expiresAt: Date | null;
      completedAt: Date | null;
      members: Array<{
        id: string;
        userId: string;
        isCreator: boolean;
        status: GroupBuyMemberStatus;
        orderId: string | null;
        paidAt: Date | null;
        user: { displayName: string };
        paymentAttempt: { status: EpayPaymentStatus } | null;
      }>;
    },
    viewerId: string,
  ) {
    const now = new Date();
    const snapshot = parseCatalogOfferSnapshot(group.entitlementSnapshot);
    const occupiedStatuses = new Set<GroupBuyMemberStatus>([
      GroupBuyMemberStatus.PAYMENT_PENDING,
      GroupBuyMemberStatus.PAID,
      GroupBuyMemberStatus.FULFILLED,
    ]);
    const occupied = group.members.filter((member) =>
      occupiedStatuses.has(member.status),
    ).length;
    const paidStatuses = new Set<GroupBuyMemberStatus>([
      GroupBuyMemberStatus.PAID,
      GroupBuyMemberStatus.FULFILLED,
      GroupBuyMemberStatus.FALLBACK_FULFILLED,
    ]);
    const paid = group.members.filter((member) =>
      paidStatuses.has(member.status),
    ).length;
    return {
      id: group.id,
      shareCode: group.shareCode,
      shareUrl: `${webPublicUrl()}/portal/group-buys/${group.shareCode}`,
      status: group.status.toLowerCase(),
      productId: snapshot?.productId ?? null,
      productName: group.productNameSnapshot,
      offerName: group.offerNameSnapshot,
      originalPriceCents:
        snapshot?.groupBuyOriginalPriceCents ?? group.priceCentsSnapshot,
      priceCents: group.priceCentsSnapshot,
      discountPercent: group.discountBasisPointsSnapshot / 100,
      currency: group.currencySnapshot,
      bonusTrafficBytes: Number(group.bonusTrafficBytesSnapshot),
      settlementMode: group.settlementModeSnapshot.toLowerCase(),
      requiredMembers: group.requiredMembersSnapshot,
      paidMembers: paid,
      openedAt: group.openedAt?.toISOString() ?? null,
      expiresAt: group.expiresAt?.toISOString() ?? null,
      completedAt: group.completedAt?.toISOString() ?? null,
      canJoin:
        group.status === GroupBuyStatus.OPEN &&
        Boolean(group.expiresAt && group.expiresAt > now) &&
        !group.members.some(
          (member) =>
            member.userId === viewerId &&
            member.status !== GroupBuyMemberStatus.PAYMENT_CLOSED,
        ) &&
        occupied < group.requiredMembersSnapshot,
      canCancel:
        group.status === GroupBuyStatus.OPEN &&
        group.settlementModeSnapshot === BALANCE_REBATE_MODE &&
        group.creatorId === viewerId &&
        Boolean(group.expiresAt && group.expiresAt > now) &&
        !group.members.some(
          (member) => !member.isCreator && occupiedStatuses.has(member.status),
        ),
      viewerMemberId:
        group.members.find((member) => member.userId === viewerId)?.id ?? null,
      members: group.members.map((member) => ({
        id: member.id,
        displayName: this.maskName(member.user.displayName),
        isCreator: member.isCreator,
        status: member.status.toLowerCase(),
        paidAt: member.paidAt?.toISOString() ?? null,
        orderId: member.userId === viewerId ? member.orderId : null,
      })),
    };
  }

  private maskName(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return '用户';
    if (trimmed.length === 1) return `${trimmed}*`;
    return `${trimmed.slice(0, 1)}${'*'.repeat(Math.min(trimmed.length - 1, 3))}`;
  }

  private shareCode() {
    return randomBytes(6).toString('base64url').toUpperCase();
  }

  private groupStatus(value: string) {
    const normalized = value.trim().toUpperCase();
    if (!Object.values(GroupBuyStatus).includes(normalized as GroupBuyStatus)) {
      throw new BadRequestException('拼团状态无效');
    }
    return normalized as GroupBuyStatus;
  }
}
