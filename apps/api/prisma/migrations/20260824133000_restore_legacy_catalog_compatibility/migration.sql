-- Legacy plans were migrated with one fixed-duration offer. Keep those
-- products sellable while newly-created V2 plans retain the full period rule.
UPDATE "CatalogProduct" product
SET "status" = 'ACTIVE'
FROM "Plan" plan
WHERE product."legacyPlanId" = plan."id"
  AND product."kind" = 'PLAN'
  AND product."status" = 'DRAFT'
  AND plan."active" = true
  AND EXISTS (
    SELECT 1
    FROM "CatalogOffer" offer
    JOIN "PlanOffer" legacy_offer
      ON legacy_offer."id" = offer."legacyPlanOfferId"
    WHERE offer."productId" = product."id"
      AND offer."billingPeriod" = 'LEGACY'
      AND offer."active" = true
      AND offer."archivedAt" IS NULL
      AND legacy_offer."active" = true
      AND legacy_offer."archivedAt" IS NULL
      AND legacy_offer."legacyDurationDays" > 0
  );

-- Global recent-session reads order only by capturedAt.
CREATE INDEX IF NOT EXISTS "OnlineSnapshot_capturedAt_idx"
ON "OnlineSnapshot"("capturedAt");
