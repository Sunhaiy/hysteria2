import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** The unique ordinal prevents concurrent transactions from recording the same use. */
export async function recordRedemptionUse(
  tx: Prisma.TransactionClient,
  data: { codeId: string; userId: string; orderId?: string | null },
) {
  const code = await tx.redemptionCode.findUnique({
    where: { id: data.codeId },
  });
  if (!code) throw new BadRequestException('兑换码不存在');
  const locked = await tx.redemptionCode.updateMany({
    where: { id: code.id, maxUsesPerUser: code.maxUsesPerUser },
    data: { maxUsesPerUser: code.maxUsesPerUser },
  });
  if (locked.count !== 1)
    throw new BadRequestException('兑换码限制已更新，请重试');
  const used = await tx.redemptionUse.count({
    where: { codeId: data.codeId, userId: data.userId },
  });
  if (used >= code.maxUsesPerUser)
    throw new BadRequestException('你已达到这张兑换码的每人使用次数上限');
  return tx.redemptionUse.create({ data: { ...data, useNumber: used + 1 } });
}
