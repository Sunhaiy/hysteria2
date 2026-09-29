import type { Prisma } from '@prisma/client';
import { PaymentFulfillmentRejectedError } from '../commerce/payment-fulfillment.error';

export const MAX_WALLET_CENTS = 2147483647;

/** A verified payment must be compensated when its full promised credit cannot fit. */
export async function assertWalletCreditCapacity(
  tx: Prisma.TransactionClient,
  userId: string,
  amountCents: number,
) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (
    !user ||
    user.deletedAt ||
    !Number.isSafeInteger(amountCents) ||
    amountCents < 0 ||
    user.balanceCents + amountCents > MAX_WALLET_CENTS
  ) {
    throw new PaymentFulfillmentRejectedError(
      'WALLET_TOPUP_UNAVAILABLE',
      '账户无法接收完整充值，款项将原路退回',
    );
  }
}
