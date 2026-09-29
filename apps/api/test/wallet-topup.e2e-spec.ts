import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { validate } from 'class-validator';
import { EpayService } from '../src/epay/epay.service';
import { CreateWalletTopupDto } from '../src/epay/epay.dto';
import {
  createEpaySignature,
  formatEpayAmount,
} from '../src/epay/epay-signature';
import { PaymentAttemptLifecycleService } from '../src/payments/payment-attempt-lifecycle.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { FinanceService } from '../src/finance/finance.service';
import { postWalletEntry } from '../src/wallet/wallet-ledger';

const url = process.env.HOLIDAY_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'ordinary wallet topups / isolated PostgreSQL',
  () => {
    let db: PrismaClient, epay: EpayService, finance: FinanceService;
    const createUser = async () =>
      (
        await db.user.create({
          data: {
            email: `${randomUUID()}@topup.test`,
            displayName: '充值测试',
            passwordHash: 'not-loginable',
          },
        })
      ).id;
    beforeAll(() => {
      const target = new URL(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.pathname !== '/holiday_test'
      )
        throw new Error('isolated holiday_test required');
      db = new PrismaClient({ datasources: { db: { url } } });
      epay = new EpayService(
        db as PrismaService,
        {
          getEpayConfig: () =>
            Promise.resolve({
              checkoutMode: 'epay',
              configured: true,
              gatewayUrl: 'https://payment.invalid/',
              merchantId: 'test',
              merchantKey: 'test-key',
            }),
        } as never,
        {} as never,
        { encrypt: (s: string) => s, decrypt: (s: string) => s } as never,
        undefined,
        undefined,
        new PaymentAttemptLifecycleService(),
      );
      finance = new FinanceService(db as PrismaService);
    });
    afterAll(async () => {
      await db?.$disconnect();
    });
    async function checkout(
      userId: string,
      amount = 1023,
      channel: 'alipay' | 'wxpay' = 'alipay',
      key = randomUUID(),
    ) {
      const payment = await epay.createWalletTopup(
        userId,
        amount,
        channel,
        key,
      );
      const attempt = await db.epayPaymentAttempt.findUniqueOrThrow({
        where: { id: payment.id },
      });
      const fields = {
        pid: 'test',
        type: channel,
        out_trade_no: attempt.merchantOrderNo,
        trade_no: `trade-${attempt.id}`,
        money: formatEpayAmount(amount),
        trade_status: 'TRADE_SUCCESS',
        sign_type: 'MD5',
      };
      const callback = {
        ...fields,
        sign: createEpaySignature(fields, 'test-key'),
      };
      return {
        payment,
        attempt,
        callback,
        settle: () => epay.processCallback(callback),
      };
    }
    it.each(['alipay', 'wxpay'] as const)(
      'credits arbitrary cents exactly once with signed %s callbacks',
      async (channel) => {
        const uid = await createUser(),
          p = await checkout(uid, 1023, channel);
        expect(
          (await db.user.findUniqueOrThrow({ where: { id: uid } }))
            .balanceCents,
        ).toBe(0);
        const results = await Promise.all([p.settle(), p.settle()]);
        expect(results.every((r) => r.accepted)).toBe(true);
        expect(
          (await db.user.findUniqueOrThrow({ where: { id: uid } }))
            .balanceCents,
        ).toBe(1023);
        expect(
          await db.walletLedgerEntry.count({ where: { userId: uid } }),
        ).toBe(1);
        expect(
          await db.manualOrder.count({
            where: { userId: uid, kind: 'WALLET_TOPUP' },
          }),
        ).toBe(1);
        expect(
          await db.entitlementGrant.count({ where: { userId: uid } }),
        ).toBe(0);
        expect(await db.holidayEntry.count({ where: { userId: uid } })).toBe(0);
        expect(
          await db.paymentRecord.count({
            where: { userId: uid, amountCents: 1023 },
          }),
        ).toBe(1);
      },
    );
    it('rejects small, fractional, overflowing amounts and unsupported channels', async () => {
      const uid = await createUser();
      for (const amount of [999, -100, 1000.1, NaN, 2147483648]) {
        await expect(
          epay.createWalletTopup(uid, amount, 'alipay', randomUUID()),
        ).rejects.toThrow();
        expect(
          (
            await validate(
              Object.assign(new CreateWalletTopupDto(), {
                amountCents: amount,
                paymentType: 'alipay',
              }),
            )
          ).length,
        ).toBeGreaterThan(0);
      }
      expect(
        (
          await validate(
            Object.assign(new CreateWalletTopupDto(), {
              amountCents: 1000,
              paymentType: 'wallet',
            }),
          )
        ).length,
      ).toBeGreaterThan(0);
      expect(
        await db.epayPaymentAttempt.count({ where: { userId: uid } }),
      ).toBe(0);
    });
    it('replays one request but forbids changing its amount or channel', async () => {
      const uid = await createUser(),
        key = randomUUID();
      const [a, b] = await Promise.all([
        epay.createWalletTopup(uid, 1000, 'alipay', key),
        epay.createWalletTopup(uid, 1000, 'alipay', key),
      ]);
      expect(a.id).toBe(b.id);
      await expect(
        epay.createWalletTopup(uid, 1001, 'alipay', key),
      ).rejects.toThrow();
      await expect(
        epay.createWalletTopup(uid, 1000, 'wxpay', key),
      ).rejects.toThrow();
    });
    it('rejects forged signatures and signed amount/channel mismatch', async () => {
      const uid = await createUser(),
        p = await checkout(uid);
      expect(
        (await epay.processCallback({ ...p.callback, sign: 'forged' }))
          .accepted,
      ).toBe(false);
      for (const patch of [{ money: '99.00' }, { type: 'wxpay' }]) {
        const wrong = { ...p.callback, ...patch };
        wrong.sign = createEpaySignature(wrong, 'test-key');
        expect((await epay.processCallback(wrong)).accepted).toBe(false);
      }
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: uid } })).balanceCents,
      ).toBe(0);
    });
    it('isolates users when listing and retrieving pending topups', async () => {
      const a = await createUser(),
        b = await createUser(),
        p = await checkout(a);
      expect(await epay.recentWalletTopups(b)).toEqual([]);
      await expect(epay.getPayment(b, p.payment.id)).rejects.toThrow();
      await expect(epay.resumeWalletTopup(b, p.payment.id)).rejects.toThrow();
      expect(await epay.resumeWalletTopup(a, p.payment.id)).toHaveProperty(
        'gateway',
      );
      await db.epayPaymentAttempt.update({
        where: { id: p.payment.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(await epay.resumeWalletTopup(a, p.payment.id)).not.toHaveProperty(
        'gateway',
      );
    });
    it('new checkout replaces old payment; old late success is compensated, never credited', async () => {
      const uid = await createUser(),
        old = await checkout(uid),
        next = await checkout(uid, 2000);
      expect((await old.settle()).accepted).toBe(true);
      expect(
        await db.epayRefundAttempt.count({
          where: { paymentAttemptId: old.attempt.id },
        }),
      ).toBe(1);
      await next.settle();
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: uid } })).balanceCents,
      ).toBe(2000);
    });
    it('expired unpaid checkout may still credit verified late money once', async () => {
      const uid = await createUser(),
        p = await checkout(uid);
      await db.epayPaymentAttempt.update({
        where: { id: p.attempt.id },
        data: { status: 'EXPIRED', activeKey: null },
      });
      await p.settle();
      await p.settle();
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: uid } })).balanceCents,
      ).toBe(1023);
    });
    it('refund deducts credit once and queues original refund; partial/wallet/repeat rejected', async () => {
      const uid = await createUser(),
        admin = await createUser(),
        p = await checkout(uid);
      await p.settle();
      const order = await db.manualOrder.findFirstOrThrow({
        where: { userId: uid },
      });
      await expect(
        finance.createRefund(
          order.id,
          { method: 'wallet', amountCents: 1023, reason: 'test' },
          admin,
        ),
      ).rejects.toThrow();
      await expect(
        finance.createRefund(
          order.id,
          { method: 'original', amountCents: 1000, reason: 'test' },
          admin,
        ),
      ).rejects.toThrow();
      expect(
        await finance.createRefund(
          order.id,
          { method: 'original', amountCents: 1023, reason: 'test' },
          admin,
        ),
      ).toMatchObject({ status: 'refund_pending' });
      await expect(
        finance.createRefund(
          order.id,
          { method: 'original', amountCents: 1023, reason: 'test' },
          admin,
        ),
      ).rejects.toThrow();
      await p.settle();
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: uid } })).balanceCents,
      ).toBe(0);
      expect(
        await db.epayRefundAttempt.count({
          where: { paymentAttemptId: p.attempt.id },
        }),
      ).toBe(1);
    });
    it('spent balance cannot become negative during a refund', async () => {
      const uid = await createUser(),
        p = await checkout(uid);
      await p.settle();
      await db.$transaction((tx) =>
        postWalletEntry(tx, {
          userId: uid,
          amountCents: -100,
          kind: 'ADJUST',
          note: 'test spend',
        }),
      );
      const order = await db.manualOrder.findFirstOrThrow({
        where: { userId: uid },
      });
      await expect(
        finance.createRefund(
          order.id,
          { method: 'original', amountCents: 1023, reason: 'test' },
          uid,
        ),
      ).rejects.toThrow('余额不足');
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: uid } })).balanceCents,
      ).toBe(923);
    });
  },
);
