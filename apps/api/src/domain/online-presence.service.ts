import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const onlinePresenceFreshnessMs = 45_000;

@Injectable()
export class OnlinePresenceService {
  constructor(private readonly prisma: PrismaService) {}

  async apply(nodeId: string, onlineMap: Record<string, number>) {
    const requestedIds = Object.entries(onlineMap)
      .filter(([, clients]) => Number.isSafeInteger(clients) && clients > 0)
      .map(([userId]) => userId);
    const users = requestedIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: requestedIds } },
          select: { id: true },
        })
      : [];
    const validIds = new Set(users.map((user) => user.id));
    const observedAt = new Date();
    const validOnline = Object.fromEntries(
      Object.entries(onlineMap).filter(
        ([userId, clients]) =>
          validIds.has(userId) && Number.isSafeInteger(clients) && clients > 0,
      ),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.onlinePresence.deleteMany({
        where: {
          nodeId,
          ...(validIds.size ? { userId: { notIn: [...validIds] } } : {}),
        },
      });
      for (const [userId, concurrentClients] of Object.entries(validOnline)) {
        await tx.onlinePresence.upsert({
          where: { userId_nodeId: { userId, nodeId } },
          create: { userId, nodeId, concurrentClients, observedAt },
          update: { concurrentClients, observedAt },
        });
      }
    });
    return validOnline;
  }

  async countForUser(userId: string) {
    const presence = await this.prisma.onlinePresence.aggregate({
      where: {
        userId,
        observedAt: {
          gte: new Date(Date.now() - onlinePresenceFreshnessMs),
        },
        concurrentClients: { gt: 0 },
      },
      _sum: { concurrentClients: true },
    });
    return presence._sum.concurrentClients ?? 0;
  }
}
