import { BadRequestException } from '@nestjs/common';
import {
  CatalogProductKind,
  EntitlementGrantKind,
  EntitlementGrantStatus,
  OrderStatus,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

type DbClient = PrismaService | Prisma.TransactionClient;

export type PurchaseRuleProduct = {
  kind: CatalogProductKind;
  purchaseLimitPerUser: number | null;
  purchaseLimitKey: string | null;
  requiresActivePlan: boolean;
};

export async function assertCatalogPurchaseEligibility(
  client: DbClient,
  userId: string,
  product: PurchaseRuleProduct,
) {
  await assertCatalogPurchaseLimit(client, userId, product);

  if (
    product.kind === CatalogProductKind.TRAFFIC_PACK &&
    product.requiresActivePlan
  ) {
    const now = new Date();
    const [v2Plans, legacyPlans] = await Promise.all([
      client.entitlementGrant.count({
        where: {
          userId,
          kind: EntitlementGrantKind.PLAN,
          status: EntitlementGrantStatus.ACTIVE,
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
      }),
      client.subscription.count({
        where: {
          userId,
          status: SubscriptionStatus.ACTIVE,
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
      }),
    ]);
    if (v2Plans === 0 && legacyPlans === 0) {
      throw new BadRequestException('需要先开通有效套餐才能使用流量包');
    }
  }
}

export async function assertCatalogPurchaseLimit(
  client: DbClient,
  userId: string,
  product: PurchaseRuleProduct,
) {
  if (product.purchaseLimitPerUser && product.purchaseLimitKey) {
    const priorPurchases = await client.manualOrder.count({
      where: {
        userId,
        status: OrderStatus.APPLIED,
        OR: [
          {
            catalogOffer: {
              product: { purchaseLimitKey: product.purchaseLimitKey },
            },
          },
          {
            plan: {
              catalogProduct: {
                purchaseLimitKey: product.purchaseLimitKey,
              },
            },
          },
        ],
      },
    });
    if (priorPurchases >= product.purchaseLimitPerUser) {
      throw new BadRequestException('该账号已经使用过体验套餐');
    }
  }
}
