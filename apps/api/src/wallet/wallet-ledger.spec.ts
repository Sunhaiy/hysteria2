import { BadRequestException } from '@nestjs/common';
import {
  postWalletEntry,
  recoverWalletCredit,
  setWalletBalance,
} from './wallet-ledger';

describe('wallet ledger module', () => {
  function client(balanceCents = 500) {
    const state = { balanceCents };
    return {
      state,
      user: {
        update: jest.fn(({ data }: { data: { balanceCents?: number } }) => {
          if (typeof data.balanceCents === 'number') {
            state.balanceCents = data.balanceCents;
          }
          return Promise.resolve({ balanceCents: state.balanceCents });
        }),
      },
      walletTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'legacy-1' }),
      },
      walletLedgerEntry: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }) =>
          Promise.resolve({ id: 'ledger-1', ...data }),
        ),
      },
    };
  }

  it('posts one atomic balance change to both compatibility and immutable ledgers', async () => {
    const tx = client();

    const posting = await postWalletEntry(tx as never, {
      userId: 'user-1',
      amountCents: -200,
      kind: 'PURCHASE',
      orderId: 'order-1',
      idempotencyKey: 'purchase-1',
      note: '购买套餐',
    });

    expect(posting).toMatchObject({
      ledgerId: 'ledger-1',
      beforeBalanceCents: 500,
      afterBalanceCents: 300,
      replayed: false,
    });
    const [ledgerWrite] = tx.walletLedgerEntry.create.mock
      .calls[0] as unknown as [{ data: Record<string, unknown> }];
    expect(ledgerWrite.data).toMatchObject({
      legacyTransactionId: 'legacy-1',
      amountCents: -200,
      beforeBalanceCents: 500,
      afterBalanceCents: 300,
    });
  });

  it('rejects a debit before writing either ledger when funds are insufficient', async () => {
    const tx = client(100);

    await expect(
      postWalletEntry(tx as never, {
        userId: 'user-1',
        amountCents: -200,
        kind: 'PURCHASE',
        note: '购买套餐',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    expect(tx.walletLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('does not hide database failures as a missing wallet owner', async () => {
    const tx = client();
    tx.user.update.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      postWalletEntry(tx as never, {
        userId: 'user-1',
        amountCents: 100,
        kind: 'ADJUST',
        note: 'Test credit',
      }),
    ).rejects.toThrow('database unavailable');
  });

  it('recovers only available balance and reports the remaining debt', async () => {
    const tx = client(120);

    const result = await recoverWalletCredit(tx as never, {
      userId: 'user-1',
      requestedCents: 200,
      kind: 'ADJUST',
      idempotencyKey: 'recovery-1',
      note: '退款追回',
    });

    expect(result).toMatchObject({ recoveredCents: 120, unrecoveredCents: 80 });
    expect(tx.state.balanceCents).toBe(0);
  });

  it('sets an absolute balance through the same locked ledger path', async () => {
    const tx = client(500);

    const result = await setWalletBalance(tx as never, {
      userId: 'user-1',
      balanceCents: 900,
      kind: 'ADJUST',
      idempotencyKey: 'admin-set-1',
      note: '管理员调整',
    });

    expect(result).toMatchObject({
      beforeBalanceCents: 500,
      afterBalanceCents: 900,
      replayed: false,
    });
    const [ledgerWrite] = tx.walletLedgerEntry.create.mock
      .calls[0] as unknown as [{ data: Record<string, unknown> }];
    expect(ledgerWrite.data).toMatchObject({ amountCents: 400 });
  });
});
