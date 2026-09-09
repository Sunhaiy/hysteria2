import { Injectable } from '@nestjs/common';
import {
  EpayPaymentStatus,
  GroupBuyMemberStatus,
  GroupBuyStatus,
  PaymentFulfillmentStatus,
  Prisma,
} from '@prisma/client';

export const PAYMENT_ABANDON_REASON_NEW_CHECKOUT = 'REPLACED_BY_NEW_CHECKOUT';

export function activeEpayCheckoutKey(userId: string) {
  return `epay-checkout:${userId}`;
}

@Injectable()
export class PaymentAttemptLifecycleService {
  async abandonPendingPayments(
    tx: Prisma.TransactionClient,
    userId: string,
    abandonedAt: Date,
  ) {
    // A verified or manually reviewed payment is no longer an unpaid checkout,
    // but an old active key must not prevent the member from ordering again.
    await tx.epayPaymentAttempt.updateMany({
      where: {
        userId,
        activeKey: { not: null },
        OR: [
          { status: { not: EpayPaymentStatus.PENDING } },
          { fulfillmentStatus: { not: PaymentFulfillmentStatus.PENDING } },
        ],
      },
      data: { activeKey: null },
    });

    const attempts = await tx.epayPaymentAttempt.findMany({
      where: {
        userId,
        status: EpayPaymentStatus.PENDING,
        fulfillmentStatus: PaymentFulfillmentStatus.PENDING,
        activeKey: { not: null },
      },
      select: {
        id: true,
        merchantOrderNo: true,
        groupBuyMember: {
          select: {
            id: true,
            groupId: true,
            isCreator: true,
            status: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const abandonedIds: string[] = [];

    for (const attempt of attempts) {
      const abandoned = await tx.epayPaymentAttempt.updateMany({
        where: {
          id: attempt.id,
          status: EpayPaymentStatus.PENDING,
          fulfillmentStatus: PaymentFulfillmentStatus.PENDING,
          activeKey: { not: null },
        },
        data: {
          status: EpayPaymentStatus.EXPIRED,
          activeKey: null,
          abandonedAt,
          abandonReason: PAYMENT_ABANDON_REASON_NEW_CHECKOUT,
        },
      });
      if (abandoned.count !== 1) continue;

      abandonedIds.push(attempt.id);
      const member = attempt.groupBuyMember;
      if (member?.status === GroupBuyMemberStatus.PAYMENT_PENDING) {
        const released = await tx.groupBuyMember.updateMany({
          where: {
            id: member.id,
            paymentAttemptId: attempt.id,
            status: GroupBuyMemberStatus.PAYMENT_PENDING,
          },
          data: {
            status: GroupBuyMemberStatus.PAYMENT_CLOSED,
            activeSlot: null,
          },
        });
        if (released.count === 1 && member.isCreator) {
          await tx.groupBuy.updateMany({
            where: {
              id: member.groupId,
              status: GroupBuyStatus.PENDING_PAYMENT,
            },
            data: {
              status: GroupBuyStatus.CANCELED,
              completedAt: abandonedAt,
            },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          action: 'EPAY_PAYMENT_ABANDONED_FOR_NEW_CHECKOUT',
          targetType: 'EpayPaymentAttempt',
          targetId: attempt.id,
          metadata: {
            userId,
            merchantOrderNo: attempt.merchantOrderNo,
            reason: PAYMENT_ABANDON_REASON_NEW_CHECKOUT,
          },
        },
      });
    }

    return abandonedIds;
  }
}
