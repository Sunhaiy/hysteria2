import {
  EpayPaymentStatus,
  GroupBuySettlementMode,
  GroupBuyMemberStatus,
  GroupBuyStatus,
  PaymentFulfillmentStatus,
  type Prisma,
} from '@prisma/client';

const ACCOUNT_DELETION_REFUND_REASON = 'ACCOUNT_DELETED_GROUP_CANCELED';

async function queueLegacyGroupRefund(
  tx: Prisma.TransactionClient,
  member: {
    id: string;
    paymentAttemptId: string | null;
    paymentAttempt: { status: EpayPaymentStatus; amountCents: number } | null;
  },
) {
  if (
    !member.paymentAttemptId ||
    member.paymentAttempt?.status !== EpayPaymentStatus.SETTLED
  ) {
    return false;
  }
  await tx.groupBuyMember.update({
    where: { id: member.id },
    data: {
      status: GroupBuyMemberStatus.REFUND_PENDING,
      activeSlot: null,
    },
  });
  await tx.epayRefundAttempt.upsert({
    where: { paymentAttemptId: member.paymentAttemptId },
    create: {
      paymentAttemptId: member.paymentAttemptId,
      groupBuyMemberId: member.id,
      amountCents: member.paymentAttempt.amountCents,
      reasonCode: ACCOUNT_DELETION_REFUND_REASON,
    },
    update: {},
  });
  await tx.epayPaymentAttempt.update({
    where: { id: member.paymentAttemptId },
    data: { fulfillmentStatus: PaymentFulfillmentStatus.REFUND_PENDING },
  });
  return true;
}

export async function closeGroupBuyParticipationForAccountDeletion(
  tx: Prisma.TransactionClient,
  userId: string,
  deletedAt: Date,
) {
  const memberships = await tx.groupBuyMember.findMany({
    where: {
      userId,
      status: {
        in: [
          GroupBuyMemberStatus.PAYMENT_PENDING,
          GroupBuyMemberStatus.PAID,
          GroupBuyMemberStatus.FULFILLED,
        ],
      },
    },
    select: {
      id: true,
      groupId: true,
      orderId: true,
      isCreator: true,
      paymentAttemptId: true,
      group: { select: { settlementModeSnapshot: true } },
      paymentAttempt: { select: { status: true, amountCents: true } },
    },
  });
  const legacyCreatedGroupIds = memberships
    .filter((membership) => membership.isCreator)
    .filter(
      (membership) =>
        membership.group.settlementModeSnapshot ===
        GroupBuySettlementMode.UPFRONT_DISCOUNT_REFUND_ON_FAILURE,
    )
    .map((membership) => membership.groupId);
  const balanceRebateCreatedGroupIds = memberships
    .filter((membership) => membership.isCreator)
    .filter(
      (membership) =>
        membership.group.settlementModeSnapshot ===
        GroupBuySettlementMode.ORIGINAL_PRICE_BALANCE_REBATE,
    )
    .map((membership) => membership.groupId);
  const legacyMemberships = memberships.filter(
    (membership) =>
      membership.group.settlementModeSnapshot ===
      GroupBuySettlementMode.UPFRONT_DISCOUNT_REFUND_ON_FAILURE,
  );
  const queuedMemberRefundIds = new Set<string>();
  for (const membership of legacyMemberships) {
    if (await queueLegacyGroupRefund(tx, membership)) {
      queuedMemberRefundIds.add(membership.id);
    }
  }
  const unpaidMembershipIds = memberships
    .filter(
      (membership) =>
        !membership.orderId && !queuedMemberRefundIds.has(membership.id),
    )
    .map((membership) => membership.id);
  const fulfilledMembershipIds = memberships
    .filter((membership) => membership.orderId)
    .map((membership) => membership.id);

  if (unpaidMembershipIds.length) {
    await tx.groupBuyMember.updateMany({
      where: { id: { in: unpaidMembershipIds } },
      data: { status: GroupBuyMemberStatus.PAYMENT_CLOSED, activeSlot: null },
    });
  }
  if (fulfilledMembershipIds.length) {
    await tx.groupBuyMember.updateMany({
      where: { id: { in: fulfilledMembershipIds } },
      data: {
        status: GroupBuyMemberStatus.FALLBACK_FULFILLED,
        activeSlot: null,
      },
    });
  }
  if (balanceRebateCreatedGroupIds.length) {
    await tx.groupBuy.updateMany({
      where: {
        id: { in: balanceRebateCreatedGroupIds },
        status: {
          in: [
            GroupBuyStatus.PENDING_PAYMENT,
            GroupBuyStatus.OPEN,
            GroupBuyStatus.FULFILLING,
          ],
        },
      },
      data: { status: GroupBuyStatus.CANCELED, completedAt: deletedAt },
    });
    await tx.groupBuyMember.updateMany({
      where: {
        groupId: { in: balanceRebateCreatedGroupIds },
        status: {
          in: [GroupBuyMemberStatus.PAYMENT_PENDING, GroupBuyMemberStatus.PAID],
        },
      },
      data: { status: GroupBuyMemberStatus.PAYMENT_CLOSED, activeSlot: null },
    });
  }

  for (const groupId of legacyCreatedGroupIds) {
    const groupMembers = await tx.groupBuyMember.findMany({
      where: {
        groupId,
        status: {
          in: [GroupBuyMemberStatus.PAYMENT_PENDING, GroupBuyMemberStatus.PAID],
        },
      },
      include: { paymentAttempt: true },
    });
    let queuedRefund = memberships.some(
      (membership) =>
        membership.groupId === groupId &&
        queuedMemberRefundIds.has(membership.id),
    );
    for (const member of groupMembers) {
      if (queuedMemberRefundIds.has(member.id)) {
        queuedRefund = true;
        continue;
      }
      if (await queueLegacyGroupRefund(tx, member)) {
        queuedRefund = true;
        queuedMemberRefundIds.add(member.id);
        continue;
      }
      await tx.groupBuyMember.update({
        where: { id: member.id },
        data: {
          status: GroupBuyMemberStatus.PAYMENT_CLOSED,
          activeSlot: null,
        },
      });
    }
    await tx.groupBuy.update({
      where: { id: groupId },
      data: {
        status: queuedRefund
          ? GroupBuyStatus.REFUNDING
          : GroupBuyStatus.CANCELED,
        completedAt: queuedRefund ? null : deletedAt,
      },
    });
  }

  return {
    closedMemberships: memberships.length,
    queuedLegacyRefunds: queuedMemberRefundIds.size,
  };
}

export { ACCOUNT_DELETION_REFUND_REASON };
