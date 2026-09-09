import {
  EpayPaymentStatus,
  GroupBuyMemberStatus,
  GroupBuyStatus,
  PaymentFulfillmentStatus,
} from '@prisma/client';
import {
  PAYMENT_ABANDON_REASON_NEW_CHECKOUT,
  PaymentAttemptLifecycleService,
} from './payment-attempt-lifecycle.service';

describe('PaymentAttemptLifecycleService', () => {
  it('abandons only unpaid active attempts and releases their group-buy slots', async () => {
    const now = new Date('2026-09-09T08:00:00.000Z');
    const payments = [
      {
        id: 'attempt-normal',
        merchantOrderNo: 'EP-NORMAL',
        groupBuyMember: null,
      },
      {
        id: 'attempt-group',
        merchantOrderNo: 'EP-GROUP',
        groupBuyMember: {
          id: 'member-1',
          groupId: 'group-1',
          isCreator: true,
          status: GroupBuyMemberStatus.PAYMENT_PENDING,
        },
      },
    ];
    const tx = {
      epayPaymentAttempt: {
        findMany: jest.fn().mockResolvedValue(payments),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      groupBuyMember: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      groupBuy: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new PaymentAttemptLifecycleService();

    await expect(
      service.abandonPendingPayments(tx as never, 'user-1', now),
    ).resolves.toEqual(['attempt-normal', 'attempt-group']);

    expect(tx.epayPaymentAttempt.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        userId: 'user-1',
        activeKey: { not: null },
        OR: [
          { status: { not: EpayPaymentStatus.PENDING } },
          { fulfillmentStatus: { not: PaymentFulfillmentStatus.PENDING } },
        ],
      },
      data: { activeKey: null },
    });
    expect(tx.epayPaymentAttempt.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
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
    expect(tx.epayPaymentAttempt.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'attempt-normal',
        status: EpayPaymentStatus.PENDING,
        fulfillmentStatus: PaymentFulfillmentStatus.PENDING,
        activeKey: { not: null },
      },
      data: {
        status: EpayPaymentStatus.EXPIRED,
        activeKey: null,
        abandonedAt: now,
        abandonReason: PAYMENT_ABANDON_REASON_NEW_CHECKOUT,
      },
    });
    expect(tx.groupBuyMember.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'member-1',
        paymentAttemptId: 'attempt-group',
        status: GroupBuyMemberStatus.PAYMENT_PENDING,
      },
      data: {
        status: GroupBuyMemberStatus.PAYMENT_CLOSED,
        activeSlot: null,
      },
    });
    expect(tx.groupBuy.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'group-1',
        status: GroupBuyStatus.PENDING_PAYMENT,
      },
      data: { status: GroupBuyStatus.CANCELED, completedAt: now },
    });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(2);
  });

  it('does not touch attempts that lost the pending-state race', async () => {
    const tx = {
      epayPaymentAttempt: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'attempt-settling',
            merchantOrderNo: 'EP-SETTLING',
            groupBuyMember: null,
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      groupBuyMember: { updateMany: jest.fn() },
      groupBuy: { updateMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const service = new PaymentAttemptLifecycleService();

    await expect(
      service.abandonPendingPayments(tx as never, 'user-1', new Date()),
    ).resolves.toEqual([]);
    expect(tx.groupBuyMember.updateMany).not.toHaveBeenCalled();
    expect(tx.groupBuy.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
