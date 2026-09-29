import { BadRequestException, ConflictException } from '@nestjs/common';
import type { EpayPaymentAttempt, ManualOrder, Prisma } from '@prisma/client';
import {
  assertWalletCreditCapacity,
  MAX_WALLET_CENTS,
} from './wallet-credit-capacity';
import { postWalletEntry } from './wallet-ledger';
import {
  grantHolidayInviteDraws,
  reverseHolidayInviteDraws,
} from '../holiday/holiday-invite-draws';

export const MIN_TOPUP_CENTS = 1000;
// PostgreSQL money columns use signed 32-bit integer cents.
export { MAX_WALLET_CENTS } from './wallet-credit-capacity';
export function validateTopupAmount(amount: number) {
  if (
    !Number.isInteger(amount) ||
    amount < MIN_TOPUP_CENTS ||
    amount > MAX_WALLET_CENTS
  )
    throw new BadRequestException(
      '充值金额至少 10 元，最多 21474836.47 元，且最多两位小数',
    );
}
export function isWalletTopup(snapshot: Prisma.JsonValue | null) {
  return (
    !!snapshot &&
    typeof snapshot === 'object' &&
    !Array.isArray(snapshot) &&
    snapshot.purchaseMode === 'wallet_topup' &&
    snapshot.version === 1
  );
}

/** Called only after signature, merchant, channel and amount verification. */
export async function fulfillWalletTopup(
  tx: Prisma.TransactionClient,
  attempt: EpayPaymentAttempt,
  tradeNo: string,
  paidAt: Date,
) {
  validateTopupAmount(attempt.amountCents);
  await assertWalletCreditCapacity(tx, attempt.userId, attempt.amountCents);
  const order = await tx.manualOrder.create({
    data: {
      userId: attempt.userId,
      kind: 'WALLET_TOPUP',
      source: 'PAYMENT',
      status: 'APPLIED',
      amountCents: attempt.amountCents,
      basePriceCents: attempt.amountCents,
      productNameSnapshot: '账户余额充值',
      idempotencyKey: `wallet-topup:${attempt.id}`,
      processedAt: paidAt,
    },
  });
  await tx.paymentRecord.create({
    data: {
      orderId: order.id,
      userId: attempt.userId,
      source: 'EPAY',
      status: 'SETTLED',
      amountCents: attempt.amountCents,
      externalRef: tradeNo,
      paidAt,
    },
  });
  await postWalletEntry(tx, {
    userId: attempt.userId,
    orderId: order.id,
    amountCents: attempt.amountCents,
    kind: 'TOPUP',
    idempotencyKey: `wallet-topup:${attempt.id}`,
    note: '在线余额充值',
  });
  await tx.auditLog.create({
    data: {
      actorId: attempt.userId,
      action: 'WALLET_TOPUP_APPLIED',
      targetType: 'ManualOrder',
      targetId: order.id,
      metadata: { attemptId: attempt.id, amountCents: attempt.amountCents },
    },
  });
  const snapshot = attempt.entitlementSnapshot as Record<
    string,
    Prisma.JsonValue
  >;
  await grantHolidayInviteDraws(
    tx,
    attempt.userId,
    order.id,
    paidAt,
    snapshot.holidayInviteRewardId as string | null | undefined,
  );
  return tx.epayPaymentAttempt.update({
    where: { id: attempt.id },
    data: {
      orderId: order.id,
      gatewayTradeNo: tradeNo,
      status: 'SETTLED',
      fulfillmentStatus: 'APPLIED',
      activeKey: null,
      settledAt: paidAt,
      closedAt: null,
      failedAt: null,
      lastSettlementError: null,
      lastSettlementFailedAt: null,
      lastQueryError: null,
    },
  });
}

export async function refundWalletTopup(
  tx: Prisma.TransactionClient,
  order: ManualOrder,
  amountCents: number,
  method: string,
  actorId: string,
  reason: string,
) {
  if (method !== 'original' || amountCents !== order.amountCents)
    throw new BadRequestException(
      '余额充值仅支持全额原路退款，不能再次退入余额',
    );
  const attempt = await tx.epayPaymentAttempt.findFirst({
    where: { orderId: order.id },
  });
  if (!attempt || !isWalletTopup(attempt.entitlementSnapshot))
    throw new ConflictException('充值支付信息不完整，请人工核验');
  if (
    attempt.fulfillmentStatus !== 'APPLIED' ||
    (await tx.refund.count({
      where: { orderId: order.id, status: { in: ['PENDING', 'APPLIED'] } },
    }))
  )
    throw new ConflictException('该充值已退款或正在退款，请勿重复操作');
  const user = await tx.user.findUniqueOrThrow({ where: { id: order.userId } });
  if (user.balanceCents < amountCents)
    throw new ConflictException('当前余额不足以追回充值，请人工处理');
  const inviteReview = await reverseHolidayInviteDraws(tx, order.id);
  if (inviteReview) throw new ConflictException(inviteReview);
  await postWalletEntry(tx, {
    userId: order.userId,
    actorId,
    orderId: order.id,
    amountCents: -amountCents,
    kind: 'ADJUST',
    idempotencyKey: `wallet-topup-refund:${order.id}`,
    note: '充值原路退款扣回余额',
  });
  await tx.epayRefundAttempt.create({
    data: {
      paymentAttemptId: attempt.id,
      amountCents,
      reasonCode: 'WALLET_TOPUP_REFUND',
    },
  });
  await tx.epayPaymentAttempt.update({
    where: { id: attempt.id },
    data: { fulfillmentStatus: 'REFUND_PENDING' },
  });
  await tx.refund.create({
    data: {
      orderId: order.id,
      processedById: actorId,
      method: 'EPAY',
      status: 'PENDING',
      amountCents,
      reason,
    },
  });
  await tx.auditLog.create({
    data: {
      actorId,
      action: 'WALLET_TOPUP_REFUND_REQUESTED',
      targetType: 'ManualOrder',
      targetId: order.id,
      metadata: { amountCents, reason },
    },
  });
  return { status: 'refund_pending', orderId: order.id };
}
