import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export type ActivationConfirmation = { expectedState: string; reason: string };
const fingerprint = (value: unknown) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_key, item: unknown) =>
        typeof item === 'bigint' ? item.toString() : item,
      ),
    )
    .digest('hex');

/** A purchased reservation changes its effective dates, never its payment identity. */
export class ScheduledPlanActivation {
  constructor(
    private readonly prisma: PrismaService,
    private readonly addMonths: (at: Date, months: number) => Date,
  ) {}

  private async read(
    tx: Prisma.TransactionClient,
    userId: string,
    grantId: string,
    now: Date,
  ) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true },
    });
    if (!user || user.deletedAt) throw new NotFoundException('用户不存在');
    const grants = await tx.entitlementGrant.findMany({
      where: {
        userId,
        kind: 'PLAN',
        status: 'ACTIVE',
        endsAt: { gt: now },
        product: { series: 'STANDARD' },
      },
      orderBy: { id: 'asc' },
      include: {
        product: true,
        quotaBuckets: {
          orderBy: { id: 'asc' },
          include: {
            _count: { select: { allocations: true, adjustments: true } },
          },
        },
        orders: {
          include: {
            refunds: true,
            epayPaymentAttempt: { include: { refundAttempt: true } },
          },
        },
      },
    });
    const target = grants.find((g) => g.id === grantId);
    if (!target || target.startsAt <= now)
      throw new NotFoundException('未找到尚未生效的普通套餐预约');
    if (
      grants.filter((g) => g.startsAt > now).length !== 1 ||
      grants.filter((g) => g.startsAt <= now).length > 1
    )
      throw new ConflictException('存在多个当前套餐或预约，请先核对权益');
    const orders = target.orders.filter((o) => o.status === 'APPLIED');
    const order = orders[0];
    if (
      orders.length !== 1 ||
      !order ||
      !['PAYMENT', 'WALLET', 'CDK'].includes(order.source) ||
      !order.intervalMonthsSnapshot ||
      ![1, 3, 12].includes(order.intervalMonthsSnapshot) ||
      target.quotaCadenceSnapshot !== 'MONTHLY_RESET'
    )
      throw new ConflictException('无法从唯一有效购买订单确定完整购买周期');
    if (
      target.quotaBuckets.length !== 1 ||
      target.quotaBuckets.some(
        (b) =>
          b.consumedBytes !== 0n ||
          b._count.allocations ||
          b._count.adjustments,
      )
    )
      throw new ConflictException('预约额度已使用或调整，不能自动提前启用');
    if (
      grants.some((g) =>
        g.orders.some(
          (o) =>
            o.refunds.some((r) => r.status !== 'VOID') ||
            o.epayPaymentAttempt?.refundAttempt,
        ),
      )
    )
      throw new ConflictException('关联套餐存在退款记录或退款处理中，请先核对');
    const cycles = target.legacySubscriptionId
      ? await tx.subscriptionCycle.findMany({
          where: { subscriptionId: target.legacySubscriptionId },
        })
      : [];
    if (
      target.legacySubscriptionId &&
      (cycles.length !== 1 ||
        cycles.some((c) => c.consumedBytes !== 0n || c.overageBytes !== 0n))
    )
      throw new ConflictException('预约订阅周期异常，请先核对');
    const bonuses = await tx.entitlementGrant.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        groupBuyBonusFor: {
          is: { order: { is: { entitlementGrantId: grantId } } },
        },
      },
      include: {
        quotaBuckets: {
          include: { _count: { select: { allocations: true } } },
        },
      },
      orderBy: { id: 'asc' },
    });
    if (
      bonuses.some(
        (g) =>
          g.startsAt <= now ||
          g.quotaBuckets.length !== 1 ||
          g.quotaBuckets.some(
            (b) => b.consumedBytes !== 0n || b._count.allocations,
          ),
      )
    )
      throw new ConflictException('关联奖励已生效或使用，请先核对');
    const current = grants.find((g) => g.startsAt <= now) ?? null;
    const endsAt = this.addMonths(now, order.intervalMonthsSnapshot);
    const bucketEnd = this.addMonths(now, 1);
    // Exclude ongoing consumption on the current plan: display losses again at commit,
    // but lock structural changes and all target/bonus state with serializable reads.
    const expectedState = fingerprint({
      grants: grants.map((g) => ({
        id: g.id,
        updatedAt: g.updatedAt,
        startsAt: g.startsAt,
        endsAt: g.endsAt,
        orders: g.orders,
      })),
      targetBuckets: target.quotaBuckets,
      bonuses,
      cycles,
    });
    return {
      target,
      current,
      order,
      bonuses,
      endsAt,
      bucketEnd,
      expectedState,
    };
  }

  async preview(userId: string, grantId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const state = await this.read(tx, userId, grantId, now);
        return this.describe(state, now);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private describe(
    state: Awaited<ReturnType<ScheduledPlanActivation['read']>>,
    now: Date,
  ) {
    return {
      grantId: state.target.id,
      productName: state.target.product.name,
      orderId: state.order.id,
      expectedState: state.expectedState,
      startsAt: now.toISOString(),
      endsAt: state.endsAt.toISOString(),
      intervalMonths: state.order.intervalMonthsSnapshot,
      current: state.current
        ? {
            productName: state.current.product.name,
            endsAt: state.current.endsAt.toISOString(),
            remainingBytes: Number(
              state.current.quotaBuckets
                .filter((b) => b.startsAt <= now && b.endsAt > now)
                .reduce(
                  (sum, b) =>
                    sum +
                    (b.grantedBytes > b.consumedBytes
                      ? b.grantedBytes - b.consumedBytes
                      : 0n),
                  0n,
                ),
            ),
          }
        : null,
      message:
        '原付款订单保留。旧普通套餐剩余时间和流量不折现、不顺延；独立流量包与永久 Ultra 不受影响。',
    };
  }

  async confirm(
    userId: string,
    grantId: string,
    input: ActivationConfirmation,
    actorId: string,
    key: string,
  ) {
    if (
      !key?.trim() ||
      key.length > 120 ||
      !input.reason?.trim() ||
      !input.expectedState
    )
      throw new BadRequestException('请填写原因并先预览，提交须带幂等标识');
    const auditId = `activation_${fingerprint({ userId, key })}`;
    const requestHash = fingerprint({ grantId, ...input });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
            const previous = await tx.auditLog.findUnique({
              where: { id: auditId },
            });
            if (previous) {
              const data = previous.metadata as {
                requestHash?: string;
                result?: Prisma.JsonValue;
              };
              if (data.requestHash !== requestHash)
                throw new ConflictException('同一幂等标识不能用于不同调整');
              return data.result;
            }
            const now = new Date();
            const state = await this.read(tx, userId, grantId, now);
            if (state.expectedState !== input.expectedState)
              throw new ConflictException('套餐状态已变化，请重新预览');
            if (state.current) {
              const oldBonuses = await tx.entitlementGrant.findMany({
                where: {
                  userId,
                  status: 'ACTIVE',
                  groupBuyBonusFor: {
                    is: {
                      order: { is: { entitlementGrantId: state.current.id } },
                    },
                  },
                },
              });
              for (const bonus of oldBonuses) {
                await tx.entitlementGrant.update({
                  where: { id: bonus.id },
                  data: { status: 'CANCELED', endsAt: now },
                });
                if (bonus.legacyTrafficPackId)
                  await tx.trafficPack.update({
                    where: { id: bonus.legacyTrafficPackId },
                    data: { expiresAt: now, status: 'EXPIRED' },
                  });
              }
              await tx.entitlementGrant.update({
                where: { id: state.current.id },
                data: { status: 'CANCELED', endsAt: now, activeSlot: null },
              });
              if (state.current.legacySubscriptionId)
                await tx.subscription.update({
                  where: { id: state.current.legacySubscriptionId },
                  data: { status: 'CANCELED', endsAt: now },
                });
            }
            await tx.entitlementGrant.update({
              where: { id: grantId },
              data: { startsAt: now, endsAt: state.endsAt, resetAnchorAt: now },
            });
            await tx.quotaBucket.update({
              where: { id: state.target.quotaBuckets[0].id },
              data: { startsAt: now, endsAt: state.bucketEnd },
            });
            if (state.target.legacySubscriptionId) {
              await tx.subscription.update({
                where: { id: state.target.legacySubscriptionId },
                data: { startsAt: now, endsAt: state.endsAt },
              });
              const cycles = await tx.subscriptionCycle.findMany({
                where: { subscriptionId: state.target.legacySubscriptionId },
              });
              if (
                cycles.length !== 1 ||
                cycles.some(
                  (c) => c.consumedBytes !== 0n || c.overageBytes !== 0n,
                )
              )
                throw new ConflictException('预约订阅周期异常，请先核对');
              await tx.subscriptionCycle.update({
                where: { id: cycles[0].id },
                data: { startsAt: now, endsAt: state.bucketEnd },
              });
            }
            for (const bonus of state.bonuses) {
              await tx.entitlementGrant.update({
                where: { id: bonus.id },
                data: { startsAt: now, endsAt: state.endsAt },
              });
              await tx.quotaBucket.updateMany({
                where: { grantId: bonus.id },
                data: { startsAt: now, endsAt: state.endsAt },
              });
              if (bonus.legacyTrafficPackId)
                await tx.trafficPack.update({
                  where: { id: bonus.legacyTrafficPackId },
                  data: { expiresAt: state.endsAt },
                });
            }
            const result = this.describe(state, now);
            await tx.auditLog.create({
              data: {
                id: auditId,
                actorId,
                action: 'entitlement.scheduled.activated',
                targetType: 'user',
                targetId: userId,
                metadata: {
                  requestHash,
                  reason: input.reason.trim(),
                  result,
                  originalStartsAt: state.target.startsAt.toISOString(),
                  originalEndsAt: state.target.endsAt.toISOString(),
                },
              },
            });
            return result;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 15000,
          },
        );
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          !['P2034', 'P2002'].includes(error.code)
        )
          throw error;
        if (attempt === 2)
          throw new ConflictException('套餐正在被其他操作更新，请重新预览');
      }
    }
    throw new ConflictException('套餐更新冲突，请重试');
  }
}
