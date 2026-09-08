import {
  EpayPaymentStatus,
  GroupBuyMemberStatus,
  GroupBuySettlementMode,
  GroupBuyStatus,
  PaymentFulfillmentStatus,
} from '@prisma/client';
import {
  ACCOUNT_DELETION_REFUND_REASON,
  closeGroupBuyParticipationForAccountDeletion,
} from './group-buy-account-cleanup';

describe('group-buy account cleanup', () => {
  it('queues refunds for paid members when a deleted creator owns a legacy group', async () => {
    const creator = {
      id: 'member-creator',
      groupId: 'group-legacy',
      orderId: null,
      isCreator: true,
      paymentAttemptId: 'payment-creator',
      group: {
        settlementModeSnapshot:
          GroupBuySettlementMode.UPFRONT_DISCOUNT_REFUND_ON_FAILURE,
      },
      paymentAttempt: {
        status: EpayPaymentStatus.SETTLED,
        amountCents: 1000,
      },
    };
    const peer = {
      ...creator,
      id: 'member-peer',
      isCreator: false,
      paymentAttemptId: 'payment-peer',
      paymentAttempt: {
        status: EpayPaymentStatus.SETTLED,
        amountCents: 1000,
      },
    };
    const tx = {
      groupBuyMember: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([creator])
          .mockResolvedValueOnce([peer]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      groupBuy: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      epayRefundAttempt: { upsert: jest.fn().mockResolvedValue({}) },
      epayPaymentAttempt: { update: jest.fn().mockResolvedValue({}) },
    };

    await expect(
      closeGroupBuyParticipationForAccountDeletion(
        tx as never,
        'user-creator',
        new Date('2026-09-07T08:00:00.000Z'),
      ),
    ).resolves.toEqual({ closedMemberships: 1, queuedLegacyRefunds: 2 });

    expect(tx.epayRefundAttempt.upsert).toHaveBeenCalledTimes(2);
    expect(tx.epayRefundAttempt.upsert).toHaveBeenCalledWith({
      where: { paymentAttemptId: 'payment-peer' },
      create: {
        paymentAttemptId: 'payment-peer',
        groupBuyMemberId: 'member-peer',
        amountCents: 1000,
        reasonCode: ACCOUNT_DELETION_REFUND_REASON,
      },
      update: {},
    });
    expect(tx.epayPaymentAttempt.update).toHaveBeenCalledWith({
      where: { id: 'payment-peer' },
      data: { fulfillmentStatus: PaymentFulfillmentStatus.REFUND_PENDING },
    });
    expect(tx.groupBuy.update).toHaveBeenCalledWith({
      where: { id: 'group-legacy' },
      data: { status: GroupBuyStatus.REFUNDING, completedAt: null },
    });
    expect(tx.groupBuyMember.update).toHaveBeenCalledWith({
      where: { id: 'member-peer' },
      data: {
        status: GroupBuyMemberStatus.REFUND_PENDING,
        activeSlot: null,
      },
    });
  });
});
