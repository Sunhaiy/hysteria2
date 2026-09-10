import { BadRequestException } from '@nestjs/common';
import { MemberOnboardingService } from './member-onboarding.service';

describe('MemberOnboardingService', () => {
  function harness(options?: {
    enabled?: boolean;
    inviteOnlyRegistration?: boolean;
    code?: object | null;
  }) {
    const findReferralCode = jest.fn().mockResolvedValue(
      options?.code === undefined
        ? {
            id: 'ref_code_1',
            ownerId: 'inviter_1',
            code: 'ABCDEFGH',
            active: true,
          }
        : options.code,
    );
    const tx = {
      referralCode: {
        findUnique: findReferralCode,
      },
      user: {
        create: jest.fn().mockResolvedValue({
          id: 'invitee_1',
          email: 'new@example.com',
          displayName: 'New member',
        }),
      },
      accessAccount: {
        create: jest.fn().mockResolvedValue({ id: 'account_1' }),
      },
      accessToken: {
        create: jest.fn().mockResolvedValue({ id: 'token_1' }),
      },
      referralAttribution: {
        create: jest.fn().mockResolvedValue({
          id: 'attribution_1',
          status: 'PENDING',
        }),
      },
    };
    const prisma = {
      referralCode: {
        findUnique: findReferralCode,
      },
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const settings = {
      getReferralConfig: jest.fn().mockResolvedValue({
        enabled: options?.enabled ?? true,
        inviteOnlyRegistration: options?.inviteOnlyRegistration ?? false,
        inviterRewardBasisPoints: 1250,
        inviteeRewardBytes: 21474836480,
      }),
    };
    return {
      prisma,
      settings,
      tx,
      service: new MemberOnboardingService(prisma as never, settings as never),
    };
  }

  it('creates a pending attribution with registration-time reward snapshots', async () => {
    const { service, tx } = harness({ inviteOnlyRegistration: true });

    const result = await service.createEmailMember({
      email: 'new@example.com',
      displayName: 'New member',
      passwordHash: 'hashed-password',
      inviteCode: 'abcdefgh',
    });

    expect(result).toMatchObject({
      userId: 'invitee_1',
      referralStatus: 'pending',
    });
    expect(tx.referralAttribution.create).toHaveBeenCalledWith({
      data: {
        inviterId: 'inviter_1',
        inviteeId: 'invitee_1',
        referralCodeId: 'ref_code_1',
        codeSnapshot: 'ABCDEFGH',
        inviterRewardCents: 0,
        inviterRewardBasisPoints: 1250,
        inviteeRewardBytes: 21474836480n,
      },
    });
  });

  it.each([
    ['an invalid code', { enabled: true, code: null }],
    [
      'a disabled activity',
      {
        enabled: false,
        code: {
          id: 'ref_code_1',
          ownerId: 'inviter_1',
          code: 'ABCDEFGH',
          active: true,
        },
      },
    ],
  ])('rejects %s without creating a member', async (_label, options) => {
    const { service, tx } = harness(options);

    await expect(
      service.createEmailMember({
        email: 'new@example.com',
        displayName: 'New member',
        passwordHash: 'hashed-password',
        inviteCode: 'ABCDEFGH',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('creates an OAuth member without referral attribution', async () => {
    const { service, tx } = harness({ enabled: false });

    const result = await service.createOAuthMember({
      email: 'oauth@example.com',
      displayName: 'OAuth member',
      passwordHash: 'hashed-password',
    });

    expect(result.referralStatus).toBeNull();
    expect(tx.user.create).toHaveBeenCalledTimes(1);
    expect(tx.referralCode.findUnique).not.toHaveBeenCalled();
    expect(tx.referralAttribution.create).not.toHaveBeenCalled();
  });

  it('requires an invite code before creating a member in invite-only mode', async () => {
    const { service, tx } = harness({ inviteOnlyRegistration: true });

    await expect(
      service.createEmailMember({
        email: 'new@example.com',
        displayName: 'New member',
        passwordHash: 'hashed-password',
      }),
    ).rejects.toThrow('当前仅限邀请注册，请填写邀请码');
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('rejects first-time OAuth onboarding in invite-only mode', async () => {
    const { service, tx } = harness({ inviteOnlyRegistration: true });

    await expect(
      service.createOAuthMember({
        email: 'oauth@example.com',
        displayName: 'OAuth member',
        passwordHash: 'hashed-password',
      }),
    ).rejects.toThrow('当前仅限邀请注册，请填写邀请码');
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('validates and normalizes an invite before a verification email is sent', async () => {
    const { service, prisma } = harness({ inviteOnlyRegistration: true });

    await expect(
      service.validateRegistrationInvite('abcdefgh'),
    ).resolves.toBeUndefined();
    expect(prisma.referralCode.findUnique).toHaveBeenCalledWith({
      where: { code: 'ABCDEFGH' },
    });
  });
});
