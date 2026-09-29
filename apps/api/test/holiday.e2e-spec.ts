import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import {
  HolidayService,
  holidayPrice,
  pickPrize,
} from '../src/holiday/holiday.service';
import {
  HOLIDAY_ID,
  DEFAULT_PRIZES,
  type HolidayPurchaseDto,
} from '../src/holiday/holiday.dto';
import { holidayTransaction } from '../src/holiday/holiday-transaction';
import { EpayService } from '../src/epay/epay.service';
import { CommerceService } from '../src/commerce/commerce.service';
import { EntitlementService } from '../src/entitlement/entitlement.service';
import { ControlPlaneStoreService } from '../src/domain/control-plane.store';
import { PaymentAttemptLifecycleService } from '../src/payments/payment-attempt-lifecycle.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { postWalletEntry } from '../src/wallet/wallet-ledger';
import { FinanceService } from '../src/finance/finance.service';
import { MemberOnboardingService } from '../src/referrals/member-onboarding.service';
import { grantHolidayInviteDraws } from '../src/holiday/holiday-invite-draws';
import { refundWalletTopup } from '../src/wallet/wallet-topup';
import { OrderQueryService } from '../src/orders/order-query.service';

const url = process.env.HOLIDAY_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'holiday commerce with isolated PostgreSQL',
  () => {
    let db: PrismaClient,
      service: HolidayService,
      epay: EpayService,
      commerce: CommerceService;
    let admin: string, offerId: string, secondOfferId: string;
    const fixtureOffers: {
      id: string;
      name: string;
      period: 'QUARTERLY' | 'YEARLY';
      price: number;
    }[] = [];
    const atomic = <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) =>
      holidayTransaction(db as PrismaService, run);
    const user = async () =>
      (
        await db.user.create({
          data: {
            email: `${randomUUID()}@holiday.test`,
            displayName: '活动验收',
            passwordHash: 'not-a-password',
            balanceCents: 100000,
          },
        })
      ).id;
    async function config(
      prizes = DEFAULT_PRIZES,
      budget = 100000,
      inviteRewardCents = 500,
    ) {
      const defaults = await service.defaults();
      await service.save(
        {
          ...defaults,
          enabled: true,
          startsAt: new Date(Date.now() - 60000).toISOString(),
          endsAt: new Date(Date.now() + 86400000).toISOString(),
          drawEndsAt: new Date(Date.now() + 86400000 * 3).toISOString(),
          giftBudgetCents: budget,
          config: {
            ...defaults.config,
            inviteRewardCents,
            offers: defaults.config.offers.filter((o) =>
              fixtureOffers.some((f) => f.id === o.offerId),
            ),
            prizes,
          },
        },
        admin,
      );
    }
    const topup = (
      tierId = '50',
      paymentType: 'alipay' | 'wxpay' = 'alipay',
    ): HolidayPurchaseDto => ({
      kind: 'TOPUP',
      tierId,
      paymentType,
      revision: 1,
      expectedPriceCents: Number(tierId) * 100,
      expectsDraw: true,
      immediateConfirmed: false,
    });
    async function pay(uid: string, input = topup(), key = randomUUID()) {
      await epay.createHolidayPayment(uid, input, key);
      const entry = await db.holidayEntry.findUniqueOrThrow({
        where: { userId_idempotencyKey: { userId: uid, idempotencyKey: key } },
      });
      const attempt = await db.epayPaymentAttempt.findUniqueOrThrow({
        where: { id: entry.attemptId! },
      });
      return {
        entry,
        attempt,
        settle: () =>
          epay.settleVerifiedPayment({
            merchantOrderNo: attempt.merchantOrderNo,
            gatewayTradeNo: `trade-${attempt.id}`,
            amountCents: attempt.amountCents,
            paymentType: attempt.paymentType,
            paidAt: new Date(),
          }),
      };
    }
    beforeAll(async () => {
      const target = new URL(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.pathname !== '/holiday_test'
      )
        throw new Error('Requires isolated local holiday_test');
      db = new PrismaClient({ datasources: { db: { url } } });
      const p = db as PrismaService;
      const lifecycle = new PaymentAttemptLifecycleService();
      commerce = new CommerceService(
        p,
        new ControlPlaneStoreService(p, {} as never),
        new EntitlementService(p),
        undefined,
        lifecycle,
      );
      service = new HolidayService(p, commerce);
      epay = new EpayService(
        p,
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
        commerce,
        { encrypt: (s: string) => s, decrypt: (s: string) => s } as never,
        undefined,
        undefined,
        lifecycle,
        service,
      );
      admin = await user();
      await db.user.update({ where: { id: admin }, data: { role: 'ADMIN' } });
      const node = await db.node.create({
        data: {
          label: `holiday-${randomUUID()}`,
          hostname: `${randomUUID()}.holiday.invalid`,
          port: 443,
          trafficApiBaseUrl: 'http://127.0.0.1:1',
          trafficApiSecret: 'test',
          active: true,
          speedUpMbps: 100,
          speedDownMbps: 100,
        },
      });
      const profile = await db.accessProfile.create({
        data: {
          name: '活动测试节点',
          slug: randomUUID(),
          speedUpMbps: 100,
          speedDownMbps: 100,
          deviceLimit: 3,
          nodeBindings: { create: { nodeId: node.id } },
        },
      });
      for (const [name, price, yearly] of [
        ['Pro', 3677, 13932],
        ['Boost', 4817, 18252],
        ['Plus', 6242, 23652],
        ['Prime', 9377, 35532],
        ['Max', 14222, 53892],
        ['Elite', 18497, 70092],
        ['Spark', 22515, 85320],
      ] as const) {
        const plan = await db.plan.create({
          data: {
            name,
            slug: randomUUID(),
            durationDays: 90,
            priceCents: price,
            trafficBytes: 100000000000n,
            speedUpMbps: 100,
            speedDownMbps: 100,
            deviceLimit: 3,
          },
        });
        const product = await db.catalogProduct.create({
          data: {
            name,
            slug: randomUUID(),
            kind: 'PLAN',
            series: 'STANDARD',
            status: 'ACTIVE',
            legacyPlanId: plan.id,
            accessProfileId: profile.id,
            quotaCadence: 'MONTHLY_RESET',
          },
        });
        for (const period of ['QUARTERLY', 'YEARLY'] as const) {
          const amount = period === 'YEARLY' ? yearly : price,
            months = period === 'YEARLY' ? 12 : 3;
          const legacy = await db.planOffer.create({
            data: {
              planId: plan.id,
              name: period,
              slug: randomUUID(),
              billingPeriod: period,
              intervalMonths: months,
              priceCents: amount,
            },
          });
          const offer = await db.catalogOffer.create({
            data: {
              productId: product.id,
              name: period,
              slug: randomUUID(),
              billingPeriod: period,
              intervalMonths: months,
              trafficBytes: 100000000000n,
              priceCents: amount,
              legacyPlanOfferId: legacy.id,
            },
          });
          fixtureOffers.push({ id: offer.id, name, period, price: amount });
          if (name === 'Pro' && period === 'QUARTERLY') offerId = offer.id;
          if (name === 'Boost' && period === 'QUARTERLY')
            secondOfferId = offer.id;
        }
      }
    });
    beforeEach(async () => {
      await db.holidayEntry.deleteMany();
      await db.holidayCampaign.deleteMany();
    });
    afterAll(async () => {
      await db?.$disconnect();
    });

    it('fulfills all seven eligible products in quarterly and yearly periods using the quoted price and cycle snapshot', async () => {
      await config();
      for (const offer of fixtureOffers) {
        const uid = await user(),
          quote = await service.quote(uid, { offerId: offer.id });
        expect(quote.finalPriceCents).toBe(Math.round(offer.price * 0.8));
        const result = await epay.createHolidayPayment(
          uid,
          {
            kind: 'PLAN',
            offerId: offer.id,
            paymentType: 'wallet',
            revision: 1,
            expectedPriceCents: quote.finalPriceCents,
            expectsDraw: true,
            immediateConfirmed: false,
          },
          'all-products',
        );
        const order = await db.manualOrder.findUniqueOrThrow({
          where: { id: result.orderId! },
        });
        expect(order.amountCents).toBe(quote.finalPriceCents);
        expect(order.billingPeriodSnapshot).toBe(offer.period);
        expect(order.intervalMonthsSnapshot).toBe(
          offer.period === 'YEARLY' ? 12 : 3,
        );
        expect(order.entitlementGrantId).not.toBeNull();
      }
    });
    async function invitedMember() {
      const inviterId = await user();
      const code = await db.referralCode.create({
        data: {
          ownerId: inviterId,
          code: randomUUID().slice(0, 8).toUpperCase(),
        },
      });
      const onboarding = new MemberOnboardingService(
        db as PrismaService,
        {
          getReferralConfig: () =>
            Promise.resolve({
              enabled: true,
              inviteOnlyRegistration: false,
              inviterRewardBasisPoints: 0,
              inviteeRewardBytes: '0',
            }),
        } as never,
      );
      const member = await onboarding.createEmailMember({
        email: randomUUID() + '@holiday.test',
        displayName: 'invited',
        passwordHash: 'test-only',
        inviteCode: code.code,
      });
      return { inviterId, inviteeId: member.userId };
    }
    it('grants one at real invite registration and tops up to three once on verified recharge', async () => {
      await config();
      const { inviterId, inviteeId } = await invitedMember();
      expect((await service.view(inviterId)).drawAvailable).toBe(1);
      await atomic((tx) => grantHolidayInviteDraws(tx, inviteeId));
      expect((await service.view(inviterId)).drawAvailable).toBe(1);
      const p = await pay(inviteeId);
      await Promise.all([p.settle(), p.settle()]);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: inviterId } }))
          .balanceCents,
      ).toBe(100500);
      expect((await service.view(inviterId)).drawAvailable).toBe(3);
      expect((await service.view(inviteeId)).drawAvailable).toBe(3);
      await (await pay(inviteeId, topup('100'))).settle();
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: inviterId } }))
          .balanceCents,
      ).toBe(100500);
      expect((await service.view(inviterId)).drawAvailable).toBe(3);
      expect((await service.view(inviteeId)).drawAvailable).toBe(6);
      const entry = await db.holidayEntry.findUniqueOrThrow({
        where: { id: p.entry.id },
      });
      expect(
        await atomic((tx) =>
          service.reverse(tx, entry.orderId!, true, 'original', admin),
        ),
      ).toBeNull();
      expect((await service.view(inviterId)).drawAvailable).toBe(1);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: inviterId } }))
          .balanceCents,
      ).toBe(100000);
      expect((await service.view(inviteeId)).drawAvailable).toBe(3);
    });
    it('recovers invited cash and drawn prizes atomically and never reissues after refund', async () => {
      await config([{ cents: 50, count: 12 }]);
      const { inviterId, inviteeId } = await invitedMember();
      await service.draw(inviterId, 'registration-prize');
      const p = await pay(inviteeId);
      await p.settle();
      await service.draw(inviterId, 'paid-prize-one');
      await service.draw(inviterId, 'paid-prize-two');
      const orderId = (
        await db.holidayEntry.findUniqueOrThrow({ where: { id: p.entry.id } })
      ).orderId!;
      expect(
        await atomic((tx) =>
          service.reverse(tx, orderId, true, 'original', admin),
        ),
      ).toBeNull();
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: inviterId } }))
          .balanceCents,
      ).toBe(100050);
      expect(
        (
          await db.holidayInviteReward.findUniqueOrThrow({
            where: { sourceOrderId: orderId },
          })
        ).status,
      ).toBe('REVERSED');
      await (await pay(inviteeId, topup('100'))).settle();
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: inviterId } }))
          .balanceCents,
      ).toBe(100050);
      expect((await service.view(inviterId)).drawAvailable).toBe(0);
    });
    it('routes unavailable invite credit to the admin queue without blocking the paying friend', async () => {
      await config();
      const { inviterId, inviteeId } = await invitedMember();
      await db.user.update({
        where: { id: inviterId },
        data: { balanceCents: 2147483640 },
      });
      const p = await pay(inviteeId);
      await p.settle();
      expect(
        (
          await db.epayPaymentAttempt.findUniqueOrThrow({
            where: { id: p.attempt.id },
          })
        ).fulfillmentStatus,
      ).toBe('APPLIED');
      expect((await service.adminView()).stats.inviteManualReview).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ inviterId, amountCents: 500 }),
        ]),
      );
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: inviterId } }))
          .balanceCents,
      ).toBe(2147483640);
    });
    it.each([0, 700])(
      'honors configured invitation cash of %s cents',
      async (amount) => {
        await config(DEFAULT_PRIZES, 100000, amount);
        const { inviterId, inviteeId } = await invitedMember();
        await (await pay(inviteeId)).settle();
        expect(
          (await db.user.findUniqueOrThrow({ where: { id: inviterId } }))
            .balanceCents,
        ).toBe(100000 + amount);
        expect((await service.view(inviterId)).drawAvailable).toBe(3);
      },
    );
    it('keeps invite awards within stock and sends already won referral cash to manual refund review', async () => {
      await config([{ cents: 50, count: 6 }]);
      const { inviterId, inviteeId } = await invitedMember();
      const p = await pay(inviteeId);
      await p.settle();
      expect((await service.view()).campaign!.reservedDraws).toBe(6);
      await service.draw(inviterId, 'registration');
      await service.draw(inviterId, 'recharge');
      const inviter = await db.user.findUniqueOrThrow({
        where: { id: inviterId },
      });
      await atomic((tx) =>
        postWalletEntry(tx, {
          userId: inviterId,
          amountCents: -inviter.balanceCents,
          kind: 'PURCHASE',
          note: 'spend invitation reward before refund',
        }),
      );
      const entry = await db.holidayEntry.findUniqueOrThrow({
        where: { id: p.entry.id },
      });
      expect(
        await atomic((tx) =>
          service.reverse(tx, entry.orderId!, true, 'original', admin),
        ),
      ).toContain('邀请人');
      expect(
        await db.epayRefundAttempt.count({
          where: { paymentAttemptId: p.attempt.id },
        }),
      ).toBe(0);
      const next = await invitedMember();
      expect((await service.view(next.inviterId)).drawAvailable).toBe(0);
    });
    it('also grants the first recharge invitation bonus for ordinary wallet topups', async () => {
      await config();
      const { inviterId, inviteeId } = await invitedMember();
      const payment = await epay.createWalletTopup(
        inviteeId,
        1000,
        'alipay',
        randomUUID(),
      );
      const attempt = await db.epayPaymentAttempt.findUniqueOrThrow({
        where: { id: payment.id },
      });
      await epay.settleVerifiedPayment({
        merchantOrderNo: attempt.merchantOrderNo,
        gatewayTradeNo: 'ordinary-' + attempt.id,
        amountCents: 1000,
        paymentType: 'alipay',
        paidAt: new Date(),
      });
      expect((await service.view(inviterId)).drawAvailable).toBe(3);
      expect((await service.view(inviteeId)).drawAvailable).toBe(0);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: inviterId } }))
          .balanceCents,
      ).toBe(100500);
      const settled = await db.epayPaymentAttempt.findUniqueOrThrow({
        where: { id: payment.id },
      });
      const order = await db.manualOrder.findUniqueOrThrow({
        where: { id: settled.orderId! },
      });
      await atomic((tx) =>
        refundWalletTopup(tx, order, 1000, 'original', admin, 'regression'),
      );
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: inviterId } }))
          .balanceCents,
      ).toBe(100000);
      expect((await service.view(inviterId)).drawAvailable).toBe(1);
    });
    it.each(['ordinary', 'holiday'])(
      'honors pending %s recharge rewards after disabling and rescheduling the campaign',
      async (kind) => {
        await config();
        const { inviterId, inviteeId } = await invitedMember();
        const attempt =
          kind === 'holiday'
            ? (await pay(inviteeId)).attempt
            : await db.epayPaymentAttempt.findUniqueOrThrow({
                where: {
                  id: (
                    await epay.createWalletTopup(
                      inviteeId,
                      1000,
                      'alipay',
                      randomUUID(),
                    )
                  ).id,
                },
              });
        await db.holidayCampaign.update({
          where: { id: HOLIDAY_ID },
          data: { enabled: false, startsAt: new Date(Date.now() + 60000) },
        });
        await epay.settleVerifiedPayment({
          merchantOrderNo: attempt.merchantOrderNo,
          gatewayTradeNo: 'closed-' + attempt.id,
          amountCents: attempt.amountCents,
          paymentType: attempt.paymentType,
          paidAt: new Date(),
        });
        expect(
          (await db.user.findUniqueOrThrow({ where: { id: inviterId } }))
            .balanceCents,
        ).toBe(100500);
        expect((await service.view(inviterId)).drawAvailable).toBe(3);
      },
    );
    it('does not award an ordinary recharge created while disabled even when the campaign reopens', async () => {
      await config();
      const { inviterId, inviteeId } = await invitedMember();
      await db.holidayCampaign.update({
        where: { id: HOLIDAY_ID },
        data: { enabled: false },
      });
      const payment = await epay.createWalletTopup(
        inviteeId,
        1000,
        'alipay',
        randomUUID(),
      );
      const attempt = await db.epayPaymentAttempt.findUniqueOrThrow({
        where: { id: payment.id },
      });
      await db.holidayCampaign.update({
        where: { id: HOLIDAY_ID },
        data: { enabled: true },
      });
      await epay.settleVerifiedPayment({
        merchantOrderNo: attempt.merchantOrderNo,
        gatewayTradeNo: 'off-' + attempt.id,
        amountCents: 1000,
        paymentType: 'alipay',
        paidAt: new Date(),
      });
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: inviterId } }))
          .balanceCents,
      ).toBe(100000);
      expect((await service.view(inviterId)).drawAvailable).toBe(1);
    });
    it('includes ordinary pending recharges when the admin filters wallet topups', async () => {
      const uid = await user();
      const payment = await epay.createWalletTopup(
        uid,
        1000,
        'wxpay',
        randomUUID(),
      );
      const result = await new OrderQueryService(
        db as PrismaService,
      ).paymentAttempts({
        productKind: 'wallet_topup',
        q: (await db.user.findUniqueOrThrow({ where: { id: uid } })).email,
      });
      expect(result.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: payment.id })]),
      );
    });
    it('does not grant invitation tickets outside the campaign window', async () => {
      await config();
      await db.holidayCampaign.update({
        where: { id: HOLIDAY_ID },
        data: { endsAt: new Date(Date.now() - 1) },
      });
      const { inviterId } = await invitedMember();
      expect((await service.view(inviterId)).drawAvailable).toBe(0);
    });
    it('preserves drawn inventory and committed terms when only invitations have participated', async () => {
      await config([{ cents: 50, count: 5 }]);
      const { inviterId } = await invitedMember();
      await service.draw(inviterId, 'one');
      const before = (await service.view()).campaign!;
      await service.save(
        {
          ...before,
          startsAt: before.startsAt.toISOString(),
          endsAt: before.endsAt.toISOString(),
          drawEndsAt: before.drawEndsAt.toISOString(),
          title: 'same stock',
        },
        admin,
      );
      expect((await service.view()).campaign!.prizes[0].count).toBe(4);
      await expect(
        service.save(
          {
            ...before,
            revision: before.revision + 1,
            config: { ...before.config, prizes: [{ cents: 50, count: 6 }] },
          },
          admin,
        ),
      ).rejects.toThrow('不可重设');
    });
    it('retries simultaneous invited registrations without losing users or issuing extra tickets', async () => {
      await config();
      const owner = await user();
      const code = await db.referralCode.create({
        data: { ownerId: owner, code: randomUUID().slice(0, 8).toUpperCase() },
      });
      const onboarding = new MemberOnboardingService(
        db as PrismaService,
        {
          getReferralConfig: () =>
            Promise.resolve({
              enabled: true,
              inviteOnlyRegistration: false,
              inviterRewardBasisPoints: 0,
              inviteeRewardBytes: '0',
            }),
        } as never,
      );
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          onboarding.createEmailMember({
            email: randomUUID() + '@holiday.test',
            displayName: 'concurrent',
            passwordHash: 'test-only',
            inviteCode: code.code,
          }),
        ),
      );
      expect(new Set(results.map((r) => r.userId)).size).toBe(6);
      expect((await service.view(owner)).drawAvailable).toBe(6);
    });
    it('compensates verified holiday recharge when principal plus gift exceeds wallet capacity', async () => {
      await config();
      const uid = await user();
      const p = await pay(uid);
      await db.user.update({
        where: { id: uid },
        data: { balanceCents: 2147483000 },
      });
      await p.settle();
      expect(
        (
          await db.epayPaymentAttempt.findUniqueOrThrow({
            where: { id: p.attempt.id },
          })
        ).fulfillmentStatus,
      ).toBe('REFUND_PENDING');
      expect(await db.walletLedgerEntry.count({ where: { userId: uid } })).toBe(
        0,
      );
      expect(
        await db.epayRefundAttempt.count({
          where: { paymentAttemptId: p.attempt.id },
        }),
      ).toBe(1);
    });
    it('defaults off, validates all quoted amounts and prize boundaries', async () => {
      expect((await service.defaults()).enabled).toBe(false);
      expect(
        [3677, 4817, 6242, 9377].map((x) => holidayPrice(x, 8000)),
      ).toEqual([2942, 3854, 4994, 7502]);
      expect(
        [13932, 18252, 23652, 35532].map((x) => holidayPrice(x, 8000)),
      ).toEqual([11146, 14602, 18922, 28426]);
      expect(DEFAULT_PRIZES.reduce((s, p) => s + p.cents * p.count, 0)).toBe(
        20000,
      );
      expect(pickPrize(DEFAULT_PRIZES, () => 299)).toBe(0);
      expect(pickPrize(DEFAULT_PRIZES, () => 300)).toBe(1);
      expect(pickPrize(DEFAULT_PRIZES, () => 499)).toBe(4);
      await expect(
        epay.createHolidayPayment(await user(), topup(), 'disabled'),
      ).rejects.toThrow('尚未开放');
    });
    it.each(['26', '38', '50', '68', '100', '200'])(
      'settles tier %s once, separates principal/gift, and freezes merchant snapshot',
      async (tier) => {
        await config();
        const uid = await user(),
          p = await pay(uid, topup(tier, tier === '100' ? 'wxpay' : 'alipay'));
        expect(p.attempt.offerId).toBeNull();
        expect(p.attempt.merchantIdSnapshot).toBe('test');
        const results = await Promise.all([p.settle(), p.settle()]);
        expect(results.every((r) => r.accepted)).toBe(true);
        const postings = await db.walletLedgerEntry.findMany({
          where: { userId: uid },
          orderBy: { createdAt: 'asc' },
        });
        expect(postings.map((x) => x.amountCents)).toEqual([
          p.entry.amountCents,
          p.entry.giftCents,
        ]);
        expect(
          (await db.user.findUniqueOrThrow({ where: { id: uid } }))
            .balanceCents,
        ).toBe(100000 + p.entry.amountCents + p.entry.giftCents);
        expect((await service.view(uid)).drawAvailable).toBe(3);
        await expect(
          epay.createHolidayPayment(uid, topup(tier), 'another'),
        ).rejects.toThrow('已参与');
      },
    );
    it('does not overspend the last gift reservation under concurrent users', async () => {
      await config(DEFAULT_PRIZES, 800);
      const users = await Promise.all([user(), user()]);
      const r = await Promise.allSettled(
        users.map((uid) =>
          epay.createHolidayPayment(uid, topup(), randomUUID()),
        ),
      );
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect(
        (
          await db.holidayCampaign.findUniqueOrThrow({
            where: { id: HOLIDAY_ID },
          })
        ).reservedGiftCents,
      ).toBe(800);
    });
    it('releases only definitively closed reservations and rejects reused keys with another channel', async () => {
      await config();
      const uid = await user(),
        key = randomUUID(),
        p = await pay(uid, topup(), key);
      await expect(
        epay.createHolidayPayment(uid, topup('50', 'wxpay'), key),
      ).rejects.toThrow('其他活动购买');
      await db.epayPaymentAttempt.update({
        where: { id: p.attempt.id },
        data: { status: 'FAILED', closedAt: new Date(), activeKey: null },
      });
      await atomic((tx) => service.closePayment(tx, p.attempt.id));
      await atomic((tx) => service.closePayment(tx, p.attempt.id));
      expect(
        (
          await db.holidayCampaign.findUniqueOrThrow({
            where: { id: HOLIDAY_ID },
          })
        ).reservedGiftCents,
      ).toBe(0);
      expect(
        (
          await db.holidayCampaign.findUniqueOrThrow({
            where: { id: HOLIDAY_ID },
          })
        ).reservedDraws,
      ).toBe(0);
      await pay(uid);
    });
    it('queues full compensation for late payment without crediting only principal', async () => {
      await config();
      const uid = await user(),
        p = await pay(uid);
      await db.epayPaymentAttempt.update({
        where: { id: p.attempt.id },
        data: { expiresAt: new Date(Date.now() - 10000) },
      });
      expect((await p.settle()).accepted).toBe(true);
      expect(await db.walletLedgerEntry.count({ where: { userId: uid } })).toBe(
        0,
      );
      expect(
        (
          await db.epayRefundAttempt.findUniqueOrThrow({
            where: { paymentAttemptId: p.attempt.id },
          })
        ).amountCents,
      ).toBe(5000);
      await atomic((tx) => service.confirmRefund(tx, p.attempt.id));
      expect(
        (
          await db.holidayCampaign.findUniqueOrThrow({
            where: { id: HOLIDAY_ID },
          })
        ).reservedGiftCents,
      ).toBe(0);
    });
    it('draws once per opportunity with concurrent replay, pays ledger once, then recovers full refund', async () => {
      await config([{ cents: 500, count: 3 }]);
      const uid = await user(),
        p = await pay(uid);
      await p.settle();
      const r = await Promise.all([
        service.draw(uid, 'same'),
        service.draw(uid, 'same'),
      ]);
      expect(r[0]).toEqual(r[1]);
      expect(r[0].prizeCents).toBe(500);
      expect((await service.view(uid)).campaign!.prizes[0].count).toBe(2);
      await service.draw(uid, 'second');
      await service.draw(uid, 'third');
      await expect(service.draw(uid, 'again')).rejects.toThrow('暂无抽奖机会');
      const order = (
        await db.holidayEntry.findUniqueOrThrow({ where: { id: p.entry.id } })
      ).orderId!;
      expect(
        await atomic((tx) =>
          service.reverse(tx, order, true, 'original', admin),
        ),
      ).toBeNull();
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: uid } })).balanceCents,
      ).toBe(100000);
      expect(
        (await db.refund.findFirstOrThrow({ where: { orderId: order } }))
          .status,
      ).toBe('PENDING');
      await atomic((tx) => service.confirmRefund(tx, p.attempt.id));
      await atomic((tx) => service.confirmRefund(tx, p.attempt.id));
      expect(
        (await db.refund.findFirstOrThrow({ where: { orderId: order } }))
          .status,
      ).toBe('APPLIED');
      await expect(
        epay.createHolidayPayment(uid, topup(), 'refund-rebuy'),
      ).rejects.toThrow('已参与');
    });
    it('keeps spent topups in explicit manual review with no partial recovery', async () => {
      await config();
      const uid = await user(),
        p = await pay(uid);
      await p.settle();
      await atomic((tx) =>
        postWalletEntry(tx, {
          userId: uid,
          amountCents: -1,
          kind: 'PURCHASE',
          note: 'test spend',
        }),
      );
      const order = (
        await db.holidayEntry.findUniqueOrThrow({ where: { id: p.entry.id } })
      ).orderId!;
      expect(
        await atomic((tx) =>
          service.reverse(tx, order, true, 'original', admin),
        ),
      ).toContain('余额支出');
      expect(
        await db.epayRefundAttempt.count({
          where: { paymentAttemptId: p.attempt.id },
        }),
      ).toBe(0);
      expect((await service.adminView()).stats.manualReview).toHaveLength(1);
    });
    it('uses activity wallet prices without altering normal quote, renews without clearing usage, and rejects another purchase after scheduling', async () => {
      await config();
      const uid = await user();
      const input: HolidayPurchaseDto = {
        kind: 'PLAN',
        offerId,
        paymentType: 'wallet',
        revision: 1,
        expectedPriceCents: 2942,
        expectsDraw: true,
        immediateConfirmed: false,
      };
      expect(
        (await commerce.quoteCheckout(uid, { offerId })).finalPriceCents,
      ).toBe(3677);
      await epay.createHolidayPayment(uid, input, 'first');
      const grant = await db.entitlementGrant.findFirstOrThrow({
        where: { userId: uid, kind: 'PLAN' },
      });
      await db.quotaBucket.updateMany({
        where: { grantId: grant.id },
        data: { consumedBytes: 123n },
      });
      await epay.createHolidayPayment(uid, input, 'renew');
      const renewed = await db.entitlementGrant.findUniqueOrThrow({
        where: { id: grant.id },
      });
      expect(renewed.endsAt.getTime()).toBeGreaterThan(grant.endsAt.getTime());
      expect(
        (
          await db.quotaBucket.findFirstOrThrow({
            where: { grantId: grant.id },
          })
        ).consumedBytes,
      ).toBe(123n);
      await epay.createHolidayPayment(
        uid,
        { ...input, offerId: secondOfferId, expectedPriceCents: 3854 },
        'switch',
      );
      expect((await service.view(uid)).drawAvailable).toBe(9);
      const scheduled = await db.entitlementGrant.findFirstOrThrow({
        where: { userId: uid, startsAt: { gt: new Date() } },
      });
      expect(scheduled.startsAt).toEqual(renewed.endsAt);
      await expect(
        epay.createHolidayPayment(
          uid,
          { ...input, expectsDraw: false },
          'blocked',
        ),
      ).rejects.toThrow();
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: uid } })).balanceCents,
      ).toBe(100000 - 2942 * 2 - 3854);
    });
    it('requires immediate confirmation and closes old plan while preserving normal storefront price', async () => {
      await config();
      const uid = await user();
      const input: HolidayPurchaseDto = {
        kind: 'PLAN',
        offerId,
        paymentType: 'wallet',
        revision: 1,
        expectedPriceCents: 2942,
        expectsDraw: true,
        immediateConfirmed: false,
      };
      await epay.createHolidayPayment(uid, input, 'first');
      const old = await db.entitlementGrant.findFirstOrThrow({
        where: { userId: uid, kind: 'PLAN' },
      });
      const next = {
        ...input,
        offerId: secondOfferId,
        expectedPriceCents: 3854,
        planActivation: 'immediate_switch' as const,
      };
      await expect(
        epay.createHolidayPayment(uid, next, 'needs-confirm'),
      ).rejects.toThrow('须确认');
      await epay.createHolidayPayment(
        uid,
        { ...next, immediateConfirmed: true },
        'confirmed',
      );
      expect(
        (await db.entitlementGrant.findUniqueOrThrow({ where: { id: old.id } }))
          .status,
      ).not.toBe('ACTIVE');
      expect(
        (await commerce.quoteCheckout(uid, { offerId })).finalPriceCents,
      ).toBe(3677);
    });
    it.each(['alipay', 'wxpay'] as const)(
      'honors frozen activity price with %s after administrative price changes',
      async (paymentType) => {
        await config();
        const uid = await user();
        const p = await pay(uid, {
          kind: 'PLAN',
          offerId,
          paymentType,
          revision: 1,
          expectedPriceCents: 2942,
          expectsDraw: true,
          immediateConfirmed: false,
        });
        await db.catalogOffer.update({
          where: { id: offerId },
          data: { priceCents: 5000 },
        });
        try {
          expect((await p.settle()).accepted).toBe(true);
          const entry = await db.holidayEntry.findUniqueOrThrow({
            where: { id: p.entry.id },
          });
          const order = await db.manualOrder.findUniqueOrThrow({
            where: { id: entry.orderId! },
          });
          expect(order.amountCents).toBe(2942);
          expect(order.discountCents).toBe(735);
          expect(
            await db.entitlementGrant.count({ where: { userId: uid } }),
          ).toBe(1);
          expect((await service.view(uid)).drawAvailable).toBe(3);
        } finally {
          await db.catalogOffer.update({
            where: { id: offerId },
            data: { priceCents: 3677 },
          });
        }
      },
    );
    it('grants three per order without a personal cap and refuses stale prize promises', async () => {
      await config();
      const uid = await user();
      for (const tier of ['50', '100', '200']) {
        const p = await pay(uid, topup(tier));
        await p.settle();
      }
      const input: HolidayPurchaseDto = {
        kind: 'PLAN',
        offerId,
        paymentType: 'wallet',
        revision: 1,
        expectedPriceCents: 2942,
        expectsDraw: true,
        immediateConfirmed: false,
      };
      await expect(
        epay.createHolidayPayment(
          uid,
          { ...input, expectsDraw: false },
          'stale-promise',
        ),
      ).rejects.toThrow('名额已变化');
      await epay.createHolidayPayment(uid, input, 'extra');
      expect((await service.view(uid)).drawAvailable).toBe(12);
      expect(
        await db.holidayEntry.count({
          where: { userId: uid, drawReserved: true },
        }),
      ).toBe(4);
    });
    it('rolls back wallet purchase and stock on insufficient funds or a tampered quote', async () => {
      await config();
      const uid = await user();
      await db.user.update({ where: { id: uid }, data: { balanceCents: 0 } });
      const input: HolidayPurchaseDto = {
        kind: 'PLAN',
        offerId,
        paymentType: 'wallet',
        revision: 1,
        expectedPriceCents: 1,
        expectsDraw: true,
        immediateConfirmed: false,
      };
      await expect(
        epay.createHolidayPayment(uid, input, 'tampered'),
      ).rejects.toThrow('价格');
      await expect(
        epay.createHolidayPayment(
          uid,
          { ...input, expectedPriceCents: 2942 },
          'empty',
        ),
      ).rejects.toThrow();
      expect(await db.holidayEntry.count({ where: { userId: uid } })).toBe(0);
      expect(await db.manualOrder.count({ where: { userId: uid } })).toBe(0);
      expect(
        (
          await db.holidayCampaign.findUniqueOrThrow({
            where: { id: HOLIDAY_ID },
          })
        ).reservedDraws,
      ).toBe(0);
    });
    it('updates uncommitted inventory and rejects shortening earned draw deadlines', async () => {
      await config();
      const existing = await service.adminView();
      await service.save(
        {
          ...existing.campaign!,
          config: {
            ...existing.campaign!.config,
            prizes: [{ cents: 100, count: 5 }],
          },
        },
        admin,
      );
      expect((await service.view()).campaign!.prizes).toEqual([
        { cents: 100, count: 5, probability: 1 },
      ]);
      const uid = await user(),
        p = await pay(uid, { ...topup(), revision: 2 });
      await p.settle();
      const c = (await service.view()).campaign!;
      await expect(
        service.save({ ...c, drawEndsAt: c.endsAt.toISOString() }, admin),
      ).rejects.toThrow('不能缩短');
    });
    it('refunds an activity wallet plan through Finance, revokes the draw and reverses its entitlement', async () => {
      await config();
      const uid = await user();
      await epay.createHolidayPayment(
        uid,
        {
          kind: 'PLAN',
          offerId,
          paymentType: 'wallet',
          revision: 1,
          expectedPriceCents: 2942,
          expectsDraw: true,
          immediateConfirmed: false,
        },
        'refund-plan',
      );
      const entry = await db.holidayEntry.findFirstOrThrow({
        where: { userId: uid },
      });
      const finance = new FinanceService(
        db as PrismaService,
        undefined,
        new EntitlementService(db as PrismaService),
        undefined,
        service,
      );
      await finance.createRefund(
        entry.orderId!,
        { amountCents: 2942, method: 'wallet', reason: 'local acceptance' },
        admin,
      );
      expect((await service.view(uid)).drawAvailable).toBe(0);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: uid } })).balanceCents,
      ).toBe(100000);
      expect(
        await db.entitlementGrant.count({
          where: { userId: uid, status: 'ACTIVE' },
        }),
      ).toBe(0);
      expect(
        (await db.holidayEntry.findUniqueOrThrow({ where: { id: entry.id } }))
          .drawReserved,
      ).toBe(true);
      await expect(
        finance.createRefund(
          entry.orderId!,
          { amountCents: 2942, method: 'wallet', reason: 'duplicate' },
          admin,
        ),
      ).rejects.toThrow();
    });
    it('queues recharge refund once through Finance without issuing another wallet credit', async () => {
      await config();
      const uid = await user(),
        p = await pay(uid);
      await p.settle();
      const orderId = (
        await db.holidayEntry.findUniqueOrThrow({ where: { id: p.entry.id } })
      ).orderId!;
      const finance = new FinanceService(
        db as PrismaService,
        undefined,
        undefined,
        undefined,
        service,
      );
      const r = await finance.createRefund(
        orderId,
        { amountCents: 5000, method: 'original', reason: 'local acceptance' },
        admin,
      );
      expect(r.status).toBe('refund_pending');
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: uid } })).balanceCents,
      ).toBe(100000);
      await expect(
        finance.createRefund(
          orderId,
          { amountCents: 5000, method: 'original', reason: 'duplicate' },
          admin,
        ),
      ).rejects.toThrow('正在退款');
      expect(await db.refund.count({ where: { orderId } })).toBe(1);
    });
    it('consumes the final prize inventory across different users without replacement', async () => {
      await config([
        { cents: 0, count: 3 },
        { cents: 500, count: 3 },
      ]);
      const a = await user(),
        b = await user();
      const p = await pay(a),
        q = await pay(b);
      await p.settle();
      await q.settle();
      const r = [];
      for (let i = 0; i < 3; i++)
        r.push(
          ...(await Promise.all([
            service.draw(a, 'last-a' + i),
            service.draw(b, 'last-b' + i),
          ])),
        );
      expect(r.map((x) => x.prizeCents).sort((x, y) => x - y)).toEqual([
        0, 0, 0, 500, 500, 500,
      ]);
      expect(
        (await service.view()).campaign!.prizes.every((x) => x.count === 0),
      ).toBe(true);
      await expect(pay(await user())).rejects.toThrow('名额已变化');
      const c = await user(),
        without = await pay(c, { ...topup(), expectsDraw: false });
      await without.settle();
      expect((await service.view(c)).drawAvailable).toBe(0);
    });
    it('honors purchase and draw deadlines independently', async () => {
      await config();
      const uid = await user(),
        p = await pay(uid);
      await p.settle();
      await db.holidayCampaign.update({
        where: { id: HOLIDAY_ID },
        data: { endsAt: new Date(Date.now() - 1) },
      });
      await expect(
        epay.createHolidayPayment(await user(), topup(), 'ended'),
      ).rejects.toThrow('活动未开放');
      await service.draw(uid, 'still-open');
      await db.holidayCampaign.update({
        where: { id: HOLIDAY_ID },
        data: { drawEndsAt: new Date(Date.now() - 1) },
      });
      await expect(service.draw(uid, 'closed')).rejects.toThrow('抽奖已结束');
    });
  },
);
