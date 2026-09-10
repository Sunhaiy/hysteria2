import type { Prisma } from '@prisma/client';

export const GO_PLAN_PURCHASE_LIMIT_KEY = 'trial-go';

export const goPlanActivityExclusionWhere = {
  OR: [
    { purchaseLimitKey: GO_PLAN_PURCHASE_LIMIT_KEY },
    { slug: { in: ['go', 'plan-go'] } },
    { slug: { startsWith: 'preview-go-' } },
    { legacyPlan: { is: { slug: 'go' } } },
  ],
} satisfies Prisma.CatalogProductWhereInput;

export function isGoPlanProduct(product: {
  series?: string;
  slug?: string;
  purchaseLimitKey?: string | null;
  legacyPlan?: { slug?: string } | null;
}) {
  if (product.series !== 'STANDARD') return false;
  const slug = product.slug?.trim().toLowerCase() ?? '';
  const legacySlug = product.legacyPlan?.slug?.trim().toLowerCase() ?? '';
  return (
    product.purchaseLimitKey === GO_PLAN_PURCHASE_LIMIT_KEY ||
    legacySlug === 'go' ||
    slug === 'go' ||
    slug === 'plan-go' ||
    slug.startsWith('preview-go-')
  );
}
