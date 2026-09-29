import type { Prisma } from '@prisma/client';
import { HOLIDAY_ID, type HolidayConfig } from './holiday.dto';
import { postWalletEntry } from '../wallet/wallet-ledger';
import { MAX_WALLET_CENTS } from '../wallet/wallet-credit-capacity';

/** Freeze existing invitation eligibility when a recharge payment is created. */
export async function snapshotHolidayInviteReward(
  tx: Prisma.TransactionClient,
  inviteeId: string,
  now = new Date(),
) {
  const campaign = await tx.holidayCampaign.findUnique({
    where: { id: HOLIDAY_ID },
  });
  if (!campaign?.enabled || now < campaign.startsAt || now > campaign.endsAt)
    return null;
  const reward = await tx.holidayInviteReward.findUnique({
    where: { campaignId_inviteeId: { campaignId: HOLIDAY_ID, inviteeId } },
  });
  return reward?.status === 'PENDING' ? reward.id : null;
}

/** Registration and verified top-ups share the same campaign lock and reward identity. */
export async function grantHolidayInviteDraws(
  tx: Prisma.TransactionClient,
  inviteeId: string,
  orderId?: string,
  occurredAt = new Date(),
  committedRewardId?: string | null,
) {
  if (orderId && committedRewardId === null) return;
  const committed = !!orderId && typeof committedRewardId === 'string';
  const campaign = await tx.holidayCampaign.findUnique({
    where: { id: HOLIDAY_ID },
  });
  if (
    !campaign ||
    (!committed &&
      (!campaign.enabled ||
        occurredAt < campaign.startsAt ||
        occurredAt > campaign.endsAt))
  )
    return;
  const attribution = await tx.referralAttribution.findUnique({
    where: { inviteeId },
  });
  if (
    !attribution ||
    attribution.inviterId === inviteeId ||
    (!committed &&
      (attribution.createdAt < campaign.startsAt ||
        attribution.createdAt > campaign.endsAt))
  )
    return;
  const c = await tx.holidayCampaign.update({
    where: { id: HOLIDAY_ID },
    data: { revision: { increment: 0 } },
  });
  if (
    !committed &&
    (!c.enabled || occurredAt < c.startsAt || occurredAt > c.endsAt)
  )
    return;
  const cfg = c.config as unknown as HolidayConfig;
  const inviter = await tx.user.findUnique({
    where: { id: attribution.inviterId },
  });
  if (!inviter) return;
  if (committed) {
    const saved = await tx.holidayInviteReward.findUnique({
      where: { campaignId_inviteeId: { campaignId: HOLIDAY_ID, inviteeId } },
    });
    if (saved?.id !== committedRewardId)
      throw new Error('Invalid invitation reward snapshot');
  }
  const reward = await tx.holidayInviteReward.upsert({
    where: { campaignId_inviteeId: { campaignId: HOLIDAY_ID, inviteeId } },
    create: {
      campaignId: HOLIDAY_ID,
      inviterId: attribution.inviterId,
      inviteeId,
      amountCents: cfg.inviteRewardCents ?? 500,
    },
    update: {},
  });
  if (orderId && reward.sourceOrderId && reward.sourceOrderId !== orderId)
    return;
  if (orderId && reward.status === 'PENDING') {
    const order = await tx.manualOrder.findUniqueOrThrow({
      where: { id: orderId },
    });
    if (
      order.userId !== inviteeId ||
      order.kind !== 'WALLET_TOPUP' ||
      order.source !== 'PAYMENT' ||
      order.status !== 'APPLIED'
    )
      throw new Error('Invalid invitation recharge source');
    if (order.amountCents < 1000) return;
    const priorRecharge = await tx.manualOrder.findFirst({
      where: {
        userId: inviteeId,
        kind: 'WALLET_TOPUP',
        source: 'PAYMENT',
        amountCents: { gte: 1000 },
        id: { not: orderId },
      },
      select: { id: true },
    });
    if (priorRecharge) {
      await tx.holidayInviteReward.update({
        where: { id: reward.id },
        data: { status: 'INELIGIBLE', sourceOrderId: orderId },
      });
      return;
    } else {
      const unavailable =
        inviter.deletedAt ||
        inviter.status !== 'ACTIVE' ||
        inviter.balanceCents + reward.amountCents > MAX_WALLET_CENTS;
      if (!unavailable)
        await postWalletEntry(tx, {
          userId: inviter.id,
          orderId,
          amountCents: reward.amountCents,
          kind: 'ADJUST',
          idempotencyKey: `holiday-invite:${reward.id}:credit`,
          note: '国庆邀请好友首次充值奖励',
        });
      await tx.holidayInviteReward.update({
        where: { id: reward.id },
        data: {
          sourceOrderId: orderId,
          status: unavailable ? 'MANUAL_REVIEW' : 'REWARDED',
          rewardedAt: unavailable ? null : occurredAt,
          reviewReason: unavailable
            ? '邀请账户不可入账或余额达到上限，请人工核验'
            : null,
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'HOLIDAY_INVITE_CASH',
          targetType: 'HolidayInviteReward',
          targetId: reward.id,
          metadata: {
            inviterId: inviter.id,
            inviteeId,
            orderId,
            amountCents: reward.amountCents,
            manualReview: Boolean(unavailable),
          },
        },
      });
    }
  }
  if (inviter.deletedAt || inviter.status !== 'ACTIVE') return;
  const prefix = `invite:${HOLIDAY_ID}:${inviteeId}:`;
  const existing = await tx.holidayDrawTicket.findMany({
    where: { sourceKey: { startsWith: prefix } },
  });
  const target = orderId ? 3 : 1;
  // Refunded rewards do not make the invitation eligible a second time.
  if (
    reward.status === 'REVERSED' ||
    reward.status === 'INELIGIBLE' ||
    existing.length >= target ||
    (orderId && existing.some((t) => t.source === 'INVITE_TOPUP'))
  )
    return;
  const count = target - existing.length;
  if (c.reservedDraws + count > cfg.prizes.reduce((sum, p) => sum + p.count, 0))
    return;
  await tx.holidayDrawTicket.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      campaignId: HOLIDAY_ID,
      userId: inviter.id,
      source: orderId ? 'INVITE_TOPUP' : 'INVITE_REGISTER',
      sourceKey: `${prefix}${existing.length + i}`,
      sourceOrderId: orderId,
      state: 'AVAILABLE',
    })),
  });
  await tx.holidayCampaign.update({
    where: { id: HOLIDAY_ID },
    data: { reservedDraws: { increment: count } },
  });
  await tx.auditLog.create({
    data: {
      action: 'HOLIDAY_INVITE_DRAWS_GRANTED',
      targetType: 'User',
      targetId: inviter.id,
      metadata: { inviteeId, orderId: orderId ?? null, count },
    },
  });
}

/** Return a review reason before making any recovery; never make the inviter's wallet negative. */
export async function reverseHolidayInviteDraws(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const tickets = await tx.holidayDrawTicket.findMany({
    where: { sourceOrderId: orderId, source: 'INVITE_TOPUP' },
  });
  const reward = await tx.holidayInviteReward.findUnique({
    where: { sourceOrderId: orderId },
  });
  if (!tickets.length && !reward) return null;
  await tx.holidayCampaign.update({
    where: { id: HOLIDAY_ID },
    data: { revision: { increment: 0 } },
  });
  if (reward?.status === 'REVERSED') return null;
  const inviterId = reward?.inviterId ?? tickets[0].userId;
  const cash = reward?.status === 'REWARDED' ? reward.amountCents : 0;
  const prizes = tickets
    .filter((t) => t.state === 'DRAWN')
    .reduce((sum, t) => sum + t.prizeCents, 0);
  const recover = cash + prizes;
  const inviter = await tx.user.findUnique({ where: { id: inviterId } });
  if (
    recover &&
    (!inviter || inviter.deletedAt || inviter.balanceCents < recover)
  )
    return '邀请人余额不足或账户不可用，无法完整追回邀请奖励，请人工核验后退款';
  if (recover)
    await postWalletEntry(tx, {
      userId: inviterId,
      orderId,
      amountCents: -recover,
      kind: 'ADJUST',
      idempotencyKey: `holiday-invite:${orderId}:recovery`,
      note: '充值退款追回邀请余额及抽奖奖励',
    });
  await tx.holidayDrawTicket.updateMany({
    where: {
      sourceOrderId: orderId,
      source: 'INVITE_TOPUP',
      state: 'AVAILABLE',
    },
    data: { state: 'REVOKED' },
  });
  if (reward)
    await tx.holidayInviteReward.update({
      where: { id: reward.id },
      data: { status: 'REVERSED', reversedAt: new Date(), reviewReason: null },
    });
  await tx.auditLog.create({
    data: {
      action: 'HOLIDAY_INVITE_REVERSED',
      targetType: 'ManualOrder',
      targetId: orderId,
      metadata: { inviterId, cashCents: cash, prizeCents: prizes },
    },
  });
  return null;
}
