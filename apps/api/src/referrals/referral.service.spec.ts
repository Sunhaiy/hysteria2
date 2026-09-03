import { BadRequestException } from '@nestjs/common';
import {
  calculateReferralRewardCents,
  ReferralService,
} from './referral.service';

describe('referral reward calculation', () => {
  it('calculates percentage cashback in integer cents and rounds down', () => {
    expect(
      calculateReferralRewardCents({
        orderAmountCents: 1290,
        inviterRewardBasisPoints: 1200,
        legacyRewardCents: 0,
      }),
    ).toBe(154);
  });

  it('preserves the promised fixed reward for legacy pending referrals', () => {
    expect(
      calculateReferralRewardCents({
        orderAmountCents: 1290,
        inviterRewardBasisPoints: null,
        legacyRewardCents: 500,
      }),
    ).toBe(500);
  });

  it('supports disabling inviter cashback with a zero percentage', () => {
    expect(
      calculateReferralRewardCents({
        orderAmountCents: 1290,
        inviterRewardBasisPoints: 0,
        legacyRewardCents: 500,
      }),
    ).toBe(0);
  });
});

describe('ReferralService member code', () => {
  it('returns one stable unambiguous code for repeated requests', async () => {
    const prisma = {
      referralCode: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'ref_code_1',
            ownerId: 'user_1',
            code: 'ABCDEFGH',
            active: true,
          }),
        create: jest.fn().mockResolvedValue({
          id: 'ref_code_1',
          ownerId: 'user_1',
          code: 'ABCDEFGH',
          active: true,
        }),
      },
    };
    const settings = {
      isReferralEnabled: jest.fn().mockResolvedValue(true),
    };
    const service = new ReferralService(prisma as never, settings as never);

    const first = await service.getOrCreateCode('user_1');
    const second = await service.getOrCreateCode('user_1');

    expect(first.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(second).toEqual(first);
    expect(prisma.referralCode.create).toHaveBeenCalledTimes(1);
  });

  it('does not generate a code while the activity is disabled', async () => {
    const prisma = {
      referralCode: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const settings = {
      isReferralEnabled: jest.fn().mockResolvedValue(false),
    };
    const service = new ReferralService(prisma as never, settings as never);

    await expect(service.getOrCreateCode('user_1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('ReferralService plan purchase settlement', () => {
  it('rewards only the first qualifying paid plan and inherits plan access', async () => {
    const rewardedAt = new Date('2027-02-01T00:00:00.000Z');
    jest.useFakeTimers().setSystemTime(rewardedAt);
    const tx = {
      referralAttribution: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'attribution_1',
          inviterId: 'inviter_1',
          inviteeId: 'invitee_1',
          status: 'PENDING',
          inviterRewardCents: 0,
          inviterRewardBasisPoints: 1200,
          inviteeRewardBytes: 21474836480n,
        }),
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
        update: jest.fn().mockResolvedValue({}),
      },
      manualOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order_1',
          userId: 'invitee_1',
          amountCents: 1290,
          source: 'PAYMENT',
          status: 'APPLIED',
          kind: 'RENEWAL',
        }),
      },
      entitlementGrant: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'plan_grant_1',
          userId: 'invitee_1',
          accessAccountId: 'account_1',
          kind: 'PLAN',
          startsAt: new Date('2027-01-31T00:00:00.000Z'),
          endsAt: new Date('2028-01-31T00:00:00.000Z'),
          accessProfileId: 'profile_1',
          speedUpMbpsSnapshot: 100,
          speedDownMbpsSnapshot: 500,
          deviceLimitSnapshot: 3,
          product: { referralEligible: true },
        }),
        create: jest.fn().mockResolvedValue({ id: 'bonus_grant_1' }),
      },
      quotaBucket: {
        create: jest.fn().mockResolvedValue({ id: 'bonus_bucket_1' }),
      },
      user: {
        update: jest.fn().mockResolvedValue({ balanceCents: 1500 }),
      },
      walletTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'wallet_legacy_1' }),
      },
      walletLedgerEntry: {
        create: jest.fn().mockResolvedValue({ id: 'wallet_ledger_1' }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new ReferralService({} as never, {} as never);

    const first = await service.settlePlanPurchaseReward(
      tx as never,
      'invitee_1',
      'order_1',
      'plan_grant_1',
    );
    const second = await service.settlePlanPurchaseReward(
      tx as never,
      'invitee_1',
      'order_2',
      'plan_grant_2',
    );

    expect(first).toEqual({ settled: true, attributionId: 'attribution_1' });
    expect(second).toEqual({ settled: false });
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'inviter_1' },
      data: { balanceCents: { increment: 154 } },
      select: { balanceCents: true },
    });
    expect(tx.referralAttribution.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'attribution_1', status: 'PENDING' },
      data: {
        status: 'REWARDED',
        qualifyingOrderId: 'order_1',
        inviterRewardCents: 154,
        rewardedAt,
      },
    });
    expect(tx.entitlementGrant.create).toHaveBeenCalledWith({
      data: {
        userId: 'invitee_1',
        accessAccountId: 'account_1',
        productId: 'system_referral_traffic_bonus',
        kind: 'TRAFFIC_PACK',
        status: 'ACTIVE',
        startsAt: rewardedAt,
        endsAt: new Date('2028-01-31T00:00:00.000Z'),
        accessProfileId: 'profile_1',
        speedUpMbpsSnapshot: 100,
        speedDownMbpsSnapshot: 500,
        deviceLimitSnapshot: 3,
      },
    });
    expect(tx.quotaBucket.create).toHaveBeenCalledWith({
      data: {
        grantId: 'bonus_grant_1',
        kind: 'TRAFFIC_PACK',
        startsAt: rewardedAt,
        endsAt: new Date('2028-01-31T00:00:00.000Z'),
        grantedBytes: 21474836480n,
      },
    });
    jest.useRealTimers();
  });

  it('does not reward a referral for an ineligible trial plan', async () => {
    const tx = {
      referralAttribution: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'attribution_1',
          inviteeId: 'invitee_1',
          status: 'PENDING',
        }),
        updateMany: jest.fn(),
      },
      entitlementGrant: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'go_grant',
          userId: 'invitee_1',
          kind: 'PLAN',
          product: { referralEligible: false },
        }),
      },
    };
    const service = new ReferralService({} as never, {} as never);

    await expect(
      service.settlePlanPurchaseReward(
        tx as never,
        'invitee_1',
        'order_go',
        'go_grant',
      ),
    ).resolves.toEqual({ settled: false });
    expect(tx.referralAttribution.updateMany).not.toHaveBeenCalled();
  });

  it.each(['WALLET', 'ADMIN'])(
    'does not reward a referral for a %s plan grant',
    async (source) => {
      const tx = {
        referralAttribution: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'attribution_1',
            inviteeId: 'invitee_1',
            status: 'PENDING',
          }),
          updateMany: jest.fn(),
        },
        entitlementGrant: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'plan_grant_1',
            userId: 'invitee_1',
            kind: 'PLAN',
            product: { referralEligible: true },
          }),
        },
        manualOrder: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'order_1',
            userId: 'invitee_1',
            source,
            status: 'APPLIED',
            kind: 'RENEWAL',
          }),
        },
      };
      const service = new ReferralService({} as never, {} as never);

      await expect(
        service.settlePlanPurchaseReward(
          tx as never,
          'invitee_1',
          'order_1',
          'plan_grant_1',
        ),
      ).resolves.toEqual({ settled: false });
      expect(tx.referralAttribution.updateMany).not.toHaveBeenCalled();
    },
  );
});

describe('ReferralService refund reversal', () => {
  it.each([
    ['full wallet recovery', 800, 500, 0, true],
    ['partial wallet recovery', 200, 200, 300, true],
    ['zero wallet recovery', 0, 0, 500, false],
  ])(
    'performs %s without making the inviter balance negative',
    async (_label, balance, recovered, unrecovered, writesLedger) => {
      const tx = {
        referralAttribution: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'attribution_1',
            inviterId: 'inviter_1',
            status: 'REWARDED',
            inviterRewardCents: 500,
            bonusEntitlementGrantId: 'bonus_grant_1',
            bonusEntitlementGrant: {
              quotaBuckets: [
                { grantedBytes: 21474836480n, consumedBytes: 5368709120n },
              ],
            },
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue({}),
        },
        user: {
          update: jest
            .fn()
            .mockResolvedValueOnce({ balanceCents: balance })
            .mockResolvedValueOnce({ balanceCents: balance - recovered }),
        },
        walletTransaction: {
          create: jest.fn().mockResolvedValue({ id: 'wallet_reverse_legacy' }),
        },
        walletLedgerEntry: {
          create: jest.fn().mockResolvedValue({ id: 'wallet_reverse_ledger' }),
        },
        entitlementGrant: { update: jest.fn().mockResolvedValue({}) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      };
      const service = new ReferralService({} as never, {} as never);

      const result = await service.reverseForRefund(
        tx as never,
        'order_1',
        'admin_1',
        'refund_1',
      );

      expect(result).toEqual({
        reversed: true,
        attributionId: 'attribution_1',
        recoveredCents: recovered,
        unrecoveredCents: unrecovered,
      });
      expect(tx.user.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'inviter_1' },
        data: { balanceCents: { increment: 0 } },
        select: { balanceCents: true },
      });
      expect(tx.walletLedgerEntry.create).toHaveBeenCalledTimes(
        writesLedger ? 1 : 0,
      );
      expect(tx.entitlementGrant.update).toHaveBeenCalledWith({
        where: { id: 'bonus_grant_1' },
        data: { status: 'CANCELED' },
      });
      expect(tx.referralAttribution.update).toHaveBeenCalledWith({
        where: { id: 'attribution_1' },
        data: {
          recoveredCents: recovered,
          unrecoveredCents: unrecovered,
          revokedUnusedBytes: 16106127360n,
          reversalWalletLedgerId: writesLedger ? 'wallet_reverse_ledger' : null,
        },
      });
    },
  );

  it('does not reverse the same reward twice', async () => {
    const tx = {
      referralAttribution: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'attribution_1',
          status: 'REWARDED',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      user: { update: jest.fn() },
    };
    const service = new ReferralService({} as never, {} as never);

    await expect(
      service.reverseForRefund(tx as never, 'order_1', 'admin_1', 'refund_2'),
    ).resolves.toEqual({ reversed: false });
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});

describe('ReferralService read models', () => {
  it('returns a paged member history with masked invitee emails', async () => {
    const prisma = {
      referralAttribution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'attribution_1',
            codeSnapshot: 'ABCDEFGH',
            status: 'REWARDED',
            inviterRewardCents: 500,
            inviteeRewardBytes: 21474836480n,
            createdAt: new Date('2027-01-01T00:00:00.000Z'),
            rewardedAt: new Date('2027-01-02T00:00:00.000Z'),
            reversedAt: null,
            invitee: { email: 'new.member@example.com' },
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const service = new ReferralService(prisma as never, {} as never);

    const result = await service.listMemberReferrals('inviter_1', {
      page: '1',
      pageSize: '20',
    });

    expect(result).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
      items: [
        {
          id: 'attribution_1',
          inviteeEmail: 'n***@example.com',
          status: 'rewarded',
          inviteeRewardBytes: 21474836480,
        },
      ],
    });
  });

  it('applies admin inviter, invitee, code, status, and time filters', async () => {
    const prisma = {
      referralAttribution: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const service = new ReferralService(prisma as never, {} as never);

    await service.listAdminReferrals({
      inviter: 'owner@example.com',
      invitee: 'new@example.com',
      inviteCode: 'abcdefgh',
      status: 'rewarded',
      from: '2027-01-01',
      to: '2027-02-01',
      page: '2',
      pageSize: '10',
    });

    expect(prisma.referralAttribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          inviter: {
            email: { contains: 'owner@example.com', mode: 'insensitive' },
          },
          invitee: {
            email: { contains: 'new@example.com', mode: 'insensitive' },
          },
          codeSnapshot: 'ABCDEFGH',
          status: 'REWARDED',
          createdAt: {
            gte: new Date('2027-01-01T00:00:00.000Z'),
            lt: new Date('2027-02-01T00:00:00.000Z'),
          },
        },
        skip: 10,
        take: 10,
      }),
    );
  });
});
