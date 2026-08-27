import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { webPublicUrl } from '../common/public-url';
import { pageResponse, parsePage, type PageQuery } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const referralAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const referralBonusProductId = 'system_referral_traffic_bonus';

export interface AdminReferralQuery extends PageQuery {
  inviter?: string;
  invitee?: string;
  inviteCode?: string;
  status?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class ReferralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async getOrCreateCode(ownerId: string) {
    const existing = await this.prisma.referralCode.findUnique({
      where: { ownerId },
    });
    if (existing) return this.presentCode(existing.code);
    if (!(await this.settings.isReferralEnabled())) {
      throw new BadRequestException('邀请活动当前未开放');
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = Array.from({ length: 8 }, () =>
        referralAlphabet.charAt(randomInt(referralAlphabet.length)),
      ).join('');
      try {
        const created = await this.prisma.referralCode.create({
          data: { ownerId, code },
        });
        return this.presentCode(created.code);
      } catch (error) {
        if (!this.isUniqueConflict(error)) throw error;
        const concurrent = await this.prisma.referralCode.findUnique({
          where: { ownerId },
        });
        if (concurrent) return this.presentCode(concurrent.code);
      }
    }
    throw new BadRequestException('邀请码生成失败，请稍后重试');
  }

  async getMemberSummary(inviterId: string) {
    const [code, total, pending, rewarded, reversed, issued, config] =
      await Promise.all([
        this.prisma.referralCode.findUnique({ where: { ownerId: inviterId } }),
        this.prisma.referralAttribution.count({ where: { inviterId } }),
        this.prisma.referralAttribution.count({
          where: { inviterId, status: 'PENDING' },
        }),
        this.prisma.referralAttribution.count({
          where: { inviterId, status: 'REWARDED' },
        }),
        this.prisma.referralAttribution.count({
          where: { inviterId, status: 'REVERSED' },
        }),
        this.prisma.referralAttribution.aggregate({
          where: { inviterId, status: { in: ['REWARDED', 'REVERSED'] } },
          _sum: { inviterRewardCents: true, recoveredCents: true },
        }),
        this.settings.getReferralConfig(),
      ]);
    return {
      code: code?.code ?? null,
      inviteUrl: code ? this.presentCode(code.code).inviteUrl : null,
      total,
      pending,
      rewarded,
      reversed,
      cumulativeRewardCents: issued._sum.inviterRewardCents ?? 0,
      currentRewardCents:
        (issued._sum.inviterRewardCents ?? 0) -
        (issued._sum.recoveredCents ?? 0),
      nextInviterRewardCents: config.inviterRewardCents,
      inviteeRewardBytes: config.inviteeRewardBytes,
      enabled: config.enabled,
    };
  }

  async listMemberReferrals(inviterId: string, query: PageQuery) {
    const { page, pageSize, skip } = parsePage(query);
    const where = { inviterId };
    const [items, total] = await Promise.all([
      this.prisma.referralAttribution.findMany({
        where,
        include: { invitee: { select: { email: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.referralAttribution.count({ where }),
    ]);
    return pageResponse(
      items.map((item) => ({
        id: item.id,
        inviteeEmail: this.maskEmail(item.invitee.email),
        inviteCode: item.codeSnapshot,
        status: item.status.toLowerCase(),
        inviterRewardCents: item.inviterRewardCents,
        inviteeRewardBytes: Number(item.inviteeRewardBytes),
        createdAt: item.createdAt.toISOString(),
        rewardedAt: item.rewardedAt?.toISOString() ?? null,
        reversedAt: item.reversedAt?.toISOString() ?? null,
      })),
      total,
      page,
      pageSize,
    );
  }

  async getAdminSummary() {
    const [total, pending, rewarded, reversed, rewards] = await Promise.all([
      this.prisma.referralAttribution.count(),
      this.prisma.referralAttribution.count({ where: { status: 'PENDING' } }),
      this.prisma.referralAttribution.count({ where: { status: 'REWARDED' } }),
      this.prisma.referralAttribution.count({ where: { status: 'REVERSED' } }),
      this.prisma.referralAttribution.aggregate({
        where: { status: { in: ['REWARDED', 'REVERSED'] } },
        _sum: {
          inviterRewardCents: true,
          inviteeRewardBytes: true,
          recoveredCents: true,
          unrecoveredCents: true,
          revokedUnusedBytes: true,
        },
      }),
    ]);
    return {
      total,
      pending,
      rewarded,
      reversed,
      issuedRewardCents: rewards._sum.inviterRewardCents ?? 0,
      issuedTrafficBytes: Number(rewards._sum.inviteeRewardBytes ?? BigInt(0)),
      recoveredCents: rewards._sum.recoveredCents ?? 0,
      unrecoveredCents: rewards._sum.unrecoveredCents ?? 0,
      revokedUnusedBytes: Number(rewards._sum.revokedUnusedBytes ?? BigInt(0)),
    };
  }

  async listAdminReferrals(query: AdminReferralQuery) {
    const { page, pageSize, skip } = parsePage(query);
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    const status = this.referralStatus(query.status);
    const where: Prisma.ReferralAttributionWhereInput = {
      inviter: query.inviter?.trim()
        ? {
            email: {
              contains: query.inviter.trim(),
              mode: 'insensitive',
            },
          }
        : undefined,
      invitee: query.invitee?.trim()
        ? {
            email: {
              contains: query.invitee.trim(),
              mode: 'insensitive',
            },
          }
        : undefined,
      codeSnapshot: query.inviteCode?.trim()
        ? query.inviteCode.trim().toUpperCase()
        : undefined,
      status,
      createdAt:
        (from && !Number.isNaN(from.getTime())) ||
        (to && !Number.isNaN(to.getTime()))
          ? {
              gte: from && !Number.isNaN(from.getTime()) ? from : undefined,
              lt: to && !Number.isNaN(to.getTime()) ? to : undefined,
            }
          : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.referralAttribution.findMany({
        where,
        include: {
          inviter: { select: { email: true, displayName: true } },
          invitee: { select: { email: true, displayName: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.referralAttribution.count({ where }),
    ]);
    return pageResponse(
      items.map((item) => ({
        id: item.id,
        inviterId: item.inviterId,
        inviterEmail: item.inviter.email,
        inviterDisplayName: item.inviter.displayName,
        inviteeId: item.inviteeId,
        inviteeEmail: item.invitee.email,
        inviteeDisplayName: item.invitee.displayName,
        inviteCode: item.codeSnapshot,
        status: item.status.toLowerCase(),
        inviterRewardCents: item.inviterRewardCents,
        inviteeRewardBytes: Number(item.inviteeRewardBytes),
        qualifyingOrderId: item.qualifyingOrderId,
        recoveredCents: item.recoveredCents,
        unrecoveredCents: item.unrecoveredCents,
        createdAt: item.createdAt.toISOString(),
        rewardedAt: item.rewardedAt?.toISOString() ?? null,
        reversedAt: item.reversedAt?.toISOString() ?? null,
      })),
      total,
      page,
      pageSize,
    );
  }

  getSettings() {
    return this.settings.getReferralConfig();
  }

  async updateSettings(
    input: { enabled: boolean; inviterRewardCents: number },
    actorId: string,
  ) {
    await this.settings.setMany({
      'referral.enabled': String(input.enabled),
      'referral.inviterRewardCents': String(input.inviterRewardCents),
    });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'referral.settings.updated',
        targetType: 'referral_settings',
        metadata: input,
      },
    });
    return this.getSettings();
  }

  async settlePlanCdkReward(
    tx: Prisma.TransactionClient,
    inviteeId: string,
    orderId: string,
    planGrantId: string,
  ) {
    const attribution = await tx.referralAttribution.findUnique({
      where: { inviteeId },
    });
    if (!attribution || attribution.status !== 'PENDING') {
      return { settled: false } as const;
    }
    const planGrant = await tx.entitlementGrant.findUnique({
      where: { id: planGrantId },
    });
    if (
      !planGrant ||
      planGrant.userId !== inviteeId ||
      planGrant.kind !== 'PLAN'
    ) {
      throw new ConflictException('Qualifying plan entitlement is missing');
    }

    const rewardedAt = new Date();
    const claimed = await tx.referralAttribution.updateMany({
      where: { id: attribution.id, status: 'PENDING' },
      data: {
        status: 'REWARDED',
        qualifyingOrderId: orderId,
        rewardedAt,
      },
    });
    if (claimed.count !== 1) return { settled: false } as const;

    const bonusGrant = await tx.entitlementGrant.create({
      data: {
        userId: inviteeId,
        accessAccountId: planGrant.accessAccountId,
        productId: referralBonusProductId,
        kind: 'TRAFFIC_PACK',
        status: 'ACTIVE',
        startsAt: rewardedAt,
        endsAt: planGrant.endsAt,
        accessProfileId: planGrant.accessProfileId,
        speedUpMbpsSnapshot: planGrant.speedUpMbpsSnapshot,
        speedDownMbpsSnapshot: planGrant.speedDownMbpsSnapshot,
        deviceLimitSnapshot: planGrant.deviceLimitSnapshot,
      },
    });
    await tx.quotaBucket.create({
      data: {
        grantId: bonusGrant.id,
        kind: 'TRAFFIC_PACK',
        startsAt: rewardedAt,
        endsAt: planGrant.endsAt,
        grantedBytes: attribution.inviteeRewardBytes,
      },
    });

    let rewardWalletLedgerId: string | null = null;
    if (attribution.inviterRewardCents > 0) {
      const updatedInviter = await tx.user.update({
        where: { id: attribution.inviterId },
        data: {
          balanceCents: { increment: attribution.inviterRewardCents },
        },
        select: { balanceCents: true },
      });
      const legacy = await tx.walletTransaction.create({
        data: {
          userId: attribution.inviterId,
          amountCents: attribution.inviterRewardCents,
          kind: 'ADJUST',
          note: `邀请奖励 ${attribution.codeSnapshot}`,
        },
      });
      const ledger = await tx.walletLedgerEntry.create({
        data: {
          legacyTransactionId: legacy.id,
          userId: attribution.inviterId,
          orderId,
          amountCents: attribution.inviterRewardCents,
          beforeBalanceCents:
            updatedInviter.balanceCents - attribution.inviterRewardCents,
          afterBalanceCents: updatedInviter.balanceCents,
          kind: 'ADJUST',
          idempotencyKey: `referral:${attribution.id}:reward`,
          note: `邀请奖励 ${attribution.codeSnapshot}`,
        },
      });
      rewardWalletLedgerId = ledger.id;
    }

    await tx.referralAttribution.update({
      where: { id: attribution.id },
      data: {
        rewardWalletLedgerId,
        bonusEntitlementGrantId: bonusGrant.id,
      },
    });
    await tx.auditLog.create({
      data: {
        action: 'referral.reward.settled',
        targetType: 'referral_attribution',
        targetId: attribution.id,
        metadata: {
          inviteeId,
          inviterId: attribution.inviterId,
          orderId,
          inviterRewardCents: attribution.inviterRewardCents,
          inviteeRewardBytes: attribution.inviteeRewardBytes.toString(),
          bonusEntitlementGrantId: bonusGrant.id,
        },
      },
    });
    return { settled: true, attributionId: attribution.id } as const;
  }

  async reverseForRefund(
    tx: Prisma.TransactionClient,
    orderId: string,
    actorId: string,
    refundId: string,
  ) {
    const attribution = await tx.referralAttribution.findUnique({
      where: { qualifyingOrderId: orderId },
      include: {
        bonusEntitlementGrant: { include: { quotaBuckets: true } },
      },
    });
    if (!attribution || attribution.status !== 'REWARDED') {
      return { reversed: false } as const;
    }
    const reversedAt = new Date();
    const claimed = await tx.referralAttribution.updateMany({
      where: { id: attribution.id, status: 'REWARDED' },
      data: { status: 'REVERSED', reversedAt },
    });
    if (claimed.count !== 1) return { reversed: false } as const;

    const lockedInviter = await tx.user.update({
      where: { id: attribution.inviterId },
      data: { balanceCents: { increment: 0 } },
      select: { balanceCents: true },
    });
    const recoveredCents = Math.min(
      lockedInviter.balanceCents,
      attribution.inviterRewardCents,
    );
    const unrecoveredCents = attribution.inviterRewardCents - recoveredCents;
    let reversalWalletLedgerId: string | null = null;
    if (recoveredCents > 0) {
      await tx.user.update({
        where: { id: attribution.inviterId },
        data: { balanceCents: { decrement: recoveredCents } },
        select: { balanceCents: true },
      });
      const legacy = await tx.walletTransaction.create({
        data: {
          userId: attribution.inviterId,
          amountCents: -recoveredCents,
          kind: 'ADJUST',
          note: `邀请奖励退款追回 ${refundId}`,
        },
      });
      const ledger = await tx.walletLedgerEntry.create({
        data: {
          legacyTransactionId: legacy.id,
          userId: attribution.inviterId,
          actorId,
          orderId,
          amountCents: -recoveredCents,
          beforeBalanceCents: lockedInviter.balanceCents,
          afterBalanceCents: lockedInviter.balanceCents - recoveredCents,
          kind: 'ADJUST',
          idempotencyKey: `referral:${attribution.id}:reversal`,
          note: `邀请奖励退款追回 ${refundId}`,
        },
      });
      reversalWalletLedgerId = ledger.id;
    }

    const revokedUnusedBytes = (
      attribution.bonusEntitlementGrant?.quotaBuckets ?? []
    ).reduce((total, bucket) => {
      const unused = bucket.grantedBytes - bucket.consumedBytes;
      return total + (unused > BigInt(0) ? unused : BigInt(0));
    }, BigInt(0));
    if (attribution.bonusEntitlementGrantId) {
      await tx.entitlementGrant.update({
        where: { id: attribution.bonusEntitlementGrantId },
        data: { status: 'CANCELED' },
      });
    }
    await tx.referralAttribution.update({
      where: { id: attribution.id },
      data: {
        recoveredCents,
        unrecoveredCents,
        revokedUnusedBytes,
        reversalWalletLedgerId,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'referral.reward.reversed',
        targetType: 'referral_attribution',
        targetId: attribution.id,
        metadata: {
          refundId,
          orderId,
          recoveredCents,
          unrecoveredCents,
          revokedUnusedBytes: revokedUnusedBytes.toString(),
        },
      },
    });
    return {
      reversed: true,
      attributionId: attribution.id,
      recoveredCents,
      unrecoveredCents,
    } as const;
  }

  private presentCode(code: string) {
    return {
      code,
      inviteUrl: `${webPublicUrl()}/register?invite=${code}`,
    };
  }

  private maskEmail(email: string) {
    const [local, domain] = email.split('@');
    if (!domain) return '***';
    return `${local?.charAt(0) || '*'}***@${domain}`;
  }

  private referralStatus(value?: string) {
    const status = value?.trim().toUpperCase();
    return status === 'PENDING' ||
      status === 'REWARDED' ||
      status === 'REVERSED'
      ? status
      : undefined;
  }

  private isUniqueConflict(error: unknown) {
    return Boolean(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'P2002',
    );
  }
}
