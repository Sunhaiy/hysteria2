UPDATE "CatalogProduct" AS product
SET
  "referralEligible" = FALSE,
  "purchaseLimitPerUser" = COALESCE(product."purchaseLimitPerUser", 1),
  "purchaseLimitKey" = 'trial-go',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE product.kind = 'PLAN'
  AND product.series = 'STANDARD'
  AND (
    product.id = 'catalog_plan_092ce625dafa9850e9'
    OR product.slug IN ('go', 'plan-go')
    OR product.slug LIKE 'preview-go-%'
    OR EXISTS (
      SELECT 1
      FROM "Plan" AS legacy_plan
      WHERE legacy_plan.id = product."legacyPlanId"
        AND legacy_plan.slug = 'go'
    )
  );
