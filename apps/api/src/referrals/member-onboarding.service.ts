import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

interface CreateMemberInput {
  email: string;
  displayName: string;
  passwordHash: string;
}

@Injectable()
export class MemberOnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  createEmailMember(input: CreateMemberInput & { inviteCode?: string }) {
    return this.createMember(input, input.inviteCode?.trim().toUpperCase());
  }

  createOAuthMember(input: CreateMemberInput) {
    return this.createMember(input);
  }

  async validateRegistrationInvite(inviteCode?: string) {
    await this.resolveRegistrationInvite(undefined, inviteCode);
  }

  private async createMember(input: CreateMemberInput, inviteCode?: string) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const { referralConfig, referralCode } =
            await this.resolveRegistrationInvite(tx, inviteCode);

          const user = await tx.user.create({
            data: {
              email: input.email,
              displayName: input.displayName,
              passwordHash: input.passwordHash,
              role: 'MEMBER',
              status: 'ACTIVE',
            },
          });
          await tx.accessAccount.create({ data: { userId: user.id } });
          await tx.accessToken.create({
            data: {
              userId: user.id,
              label: 'Primary access token',
              token: randomBytes(32).toString('base64url'),
            },
          });

          let referralStatus: 'pending' | null = null;
          if (referralCode) {
            await tx.referralAttribution.create({
              data: {
                inviterId: referralCode.ownerId,
                inviteeId: user.id,
                referralCodeId: referralCode.id,
                codeSnapshot: referralCode.code,
                inviterRewardCents: 0,
                inviterRewardBasisPoints:
                  referralConfig.inviterRewardBasisPoints,
                inviteeRewardBytes: BigInt(referralConfig.inviteeRewardBytes),
              },
            });
            referralStatus = 'pending';
          }
          return { userId: user.id, referralStatus };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('该邮箱已注册，请直接登录');
      }
      throw error;
    }
  }

  private async resolveRegistrationInvite(
    client: Prisma.TransactionClient | undefined,
    rawInviteCode?: string,
  ) {
    const inviteCode = rawInviteCode?.trim().toUpperCase() || undefined;
    const referralConfig = await this.settings.getReferralConfig(client);

    if (referralConfig.inviteOnlyRegistration && !referralConfig.enabled) {
      throw new BadRequestException('邀请系统暂未开放，请联系管理员');
    }
    if (referralConfig.inviteOnlyRegistration && !inviteCode) {
      throw new BadRequestException('当前仅限邀请注册，请填写邀请码');
    }
    if (!inviteCode) {
      return { referralConfig, referralCode: null };
    }
    if (!referralConfig.enabled) {
      throw new BadRequestException('邀请码无效或邀请系统未开放');
    }

    const referralCode = client
      ? await client.referralCode.findUnique({ where: { code: inviteCode } })
      : await this.prisma.referralCode.findUnique({
          where: { code: inviteCode },
        });
    if (!referralCode?.active) {
      throw new BadRequestException('邀请码无效或已停用');
    }
    return { referralConfig, referralCode };
  }
}
