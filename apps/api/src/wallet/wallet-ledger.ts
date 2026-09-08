import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, type WalletTxnKind } from '@prisma/client';

type WalletClient = Prisma.TransactionClient;

export interface WalletPosting {
  userId: string;
  amountCents: number;
  kind: WalletTxnKind;
  actorId?: string;
  orderId?: string;
  idempotencyKey?: string;
  note: string;
  allowDeletedUser?: boolean;
}

export interface WalletPostingResult {
  ledgerId: string | null;
  beforeBalanceCents: number;
  afterBalanceCents: number;
  replayed: boolean;
}

export interface WalletBalanceSet extends Omit<WalletPosting, 'amountCents'> {
  balanceCents: number;
}

async function existingPosting(
  client: WalletClient,
  input: Pick<WalletPosting, 'userId' | 'idempotencyKey'>,
) {
  if (!input.idempotencyKey) return null;
  return client.walletLedgerEntry.findUnique({
    where: {
      userId_idempotencyKey: {
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
}

async function lockWallet(client: WalletClient, userId: string) {
  try {
    return await client.user.update({
      where: { id: userId },
      data: { balanceCents: { increment: 0 } },
      select: { balanceCents: true, deletedAt: true },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException('Wallet owner not found');
    }
    throw error;
  }
}

async function writePosting(
  client: WalletClient,
  input: WalletPosting,
  beforeBalanceCents: number,
): Promise<WalletPostingResult> {
  const afterBalanceCents = beforeBalanceCents + input.amountCents;
  if (afterBalanceCents < 0) {
    throw new BadRequestException('Insufficient wallet balance');
  }
  if (input.amountCents === 0) {
    return {
      ledgerId: null,
      beforeBalanceCents,
      afterBalanceCents,
      replayed: false,
    };
  }
  await client.user.update({
    where: { id: input.userId },
    data: { balanceCents: afterBalanceCents },
  });
  const legacy = await client.walletTransaction.create({
    data: {
      userId: input.userId,
      amountCents: input.amountCents,
      kind: input.kind,
      note: input.note,
    },
  });
  const ledger = await client.walletLedgerEntry.create({
    data: {
      legacyTransactionId: legacy.id,
      userId: input.userId,
      actorId: input.actorId,
      orderId: input.orderId,
      amountCents: input.amountCents,
      beforeBalanceCents,
      afterBalanceCents,
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      note: input.note,
    },
  });
  return {
    ledgerId: ledger.id,
    beforeBalanceCents,
    afterBalanceCents,
    replayed: false,
  };
}

export async function postWalletEntry(
  client: WalletClient,
  input: WalletPosting,
): Promise<WalletPostingResult> {
  if (!Number.isSafeInteger(input.amountCents)) {
    throw new BadRequestException('Wallet amount must be integer cents');
  }
  const existing = await existingPosting(client, input);
  if (existing) {
    return {
      ledgerId: existing.id,
      beforeBalanceCents: existing.beforeBalanceCents ?? 0,
      afterBalanceCents: existing.afterBalanceCents ?? 0,
      replayed: true,
    };
  }
  const wallet = await lockWallet(client, input.userId);
  if (wallet.deletedAt && !input.allowDeletedUser) {
    throw new BadRequestException('Wallet owner is deleted');
  }
  const committedWhileWaiting = await existingPosting(client, input);
  if (committedWhileWaiting) {
    return {
      ledgerId: committedWhileWaiting.id,
      beforeBalanceCents: committedWhileWaiting.beforeBalanceCents ?? 0,
      afterBalanceCents: committedWhileWaiting.afterBalanceCents ?? 0,
      replayed: true,
    };
  }
  return writePosting(client, input, wallet.balanceCents);
}

export async function setWalletBalance(
  client: WalletClient,
  input: WalletBalanceSet,
): Promise<WalletPostingResult> {
  if (!Number.isSafeInteger(input.balanceCents) || input.balanceCents < 0) {
    throw new BadRequestException(
      'Wallet balance must be non-negative integer cents',
    );
  }
  const existing = await existingPosting(client, input);
  if (existing) {
    return {
      ledgerId: existing.id,
      beforeBalanceCents: existing.beforeBalanceCents ?? 0,
      afterBalanceCents: existing.afterBalanceCents ?? 0,
      replayed: true,
    };
  }
  const wallet = await lockWallet(client, input.userId);
  if (wallet.deletedAt && !input.allowDeletedUser) {
    throw new BadRequestException('Wallet owner is deleted');
  }
  const committedWhileWaiting = await existingPosting(client, input);
  if (committedWhileWaiting) {
    return {
      ledgerId: committedWhileWaiting.id,
      beforeBalanceCents: committedWhileWaiting.beforeBalanceCents ?? 0,
      afterBalanceCents: committedWhileWaiting.afterBalanceCents ?? 0,
      replayed: true,
    };
  }
  return writePosting(
    client,
    { ...input, amountCents: input.balanceCents - wallet.balanceCents },
    wallet.balanceCents,
  );
}

export async function recoverWalletCredit(
  client: WalletClient,
  input: Omit<WalletPosting, 'amountCents'> & { requestedCents: number },
) {
  if (!Number.isSafeInteger(input.requestedCents) || input.requestedCents < 0) {
    throw new BadRequestException('Recovery amount must be positive cents');
  }
  const existing = await existingPosting(client, input);
  if (existing) {
    const recoveredCents = Math.max(0, -existing.amountCents);
    return {
      ledgerId: existing.id,
      recoveredCents,
      unrecoveredCents: Math.max(0, input.requestedCents - recoveredCents),
      replayed: true,
    };
  }
  const wallet = await lockWallet(client, input.userId);
  const committedWhileWaiting = await existingPosting(client, input);
  if (committedWhileWaiting) {
    const recoveredCents = Math.max(0, -committedWhileWaiting.amountCents);
    return {
      ledgerId: committedWhileWaiting.id,
      recoveredCents,
      unrecoveredCents: Math.max(0, input.requestedCents - recoveredCents),
      replayed: true,
    };
  }
  const recoveredCents = Math.min(wallet.balanceCents, input.requestedCents);
  const posting = await writePosting(
    client,
    { ...input, amountCents: -recoveredCents },
    wallet.balanceCents,
  );
  return {
    ledgerId: posting.ledgerId,
    recoveredCents,
    unrecoveredCents: input.requestedCents - recoveredCents,
    replayed: false,
  };
}
