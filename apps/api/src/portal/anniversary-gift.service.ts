import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CommerceService } from '../commerce/commerce.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { calculateMembershipJourneyForUser } from './portal-membership';

export const FIRST_ANNIVERSARY_GIFT_KEY = 'anniversary-gift:first';

@Injectable()
export class AnniversaryGiftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly commerce: CommerceService,
  ) {}

  async getStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const [config, membership, claimedOrder] = await Promise.all([
      this.settings.getAnniversaryGiftConfig(),
      calculateMembershipJourneyForUser(this.prisma, {
        userId,
        registeredAt: user.createdAt,
      }),
      this.prisma.manualOrder.findUnique({
        where: {
          userId_idempotencyKey: {
            userId,
            idempotencyKey: FIRST_ANNIVERSARY_GIFT_KEY,
          },
        },
        select: { id: true, processedAt: true },
      }),
    ]);
    const claimed = Boolean(claimedOrder);
    const eligible = membership.anniversaryEligible;

    return {
      enabled: config.enabled,
      configured: config.configured,
      eligible,
      claimable: config.enabled && config.configured && eligible && !claimed,
      claimed,
      claimedAt: claimedOrder?.processedAt?.toISOString() ?? null,
      orderId: claimedOrder?.id ?? null,
      milestoneDays: membership.anniversaryTargetDays,
      subscribedDays: membership.subscribedDays,
      gift: config.gift,
    };
  }

  async claim(userId: string) {
    const status = await this.getStatus(userId);
    if (status.claimed) return { ...status, replayed: true };
    if (!status.enabled || !status.configured || !status.gift) {
      throw new BadRequestException('周年礼物当前未开放领取');
    }
    if (!status.eligible) {
      throw new BadRequestException(
        `累计满 ${status.milestoneDays} 个有效订阅日后即可领取`,
      );
    }

    const result = await this.commerce.grantAnniversaryTrafficPack(
      userId,
      status.gift.offerId,
      FIRST_ANNIVERSARY_GIFT_KEY,
    );
    return {
      ...(await this.getStatus(userId)),
      replayed: result.replayed,
      orderId: result.orderId,
    };
  }
}
