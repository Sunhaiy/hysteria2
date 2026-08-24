-- Existing products that do not yet satisfy V2 public offer rules remain
-- available through the legacy API, but are not published by the V2 catalog.
UPDATE "CatalogProduct" product
SET "status" = 'DRAFT'
WHERE product."kind" = 'PLAN'
  AND product."status" = 'ACTIVE'
  AND NOT (
    EXISTS (
      SELECT 1 FROM "CatalogOffer" offer
      WHERE offer."productId" = product."id"
        AND offer."billingPeriod" = 'MONTHLY'
        AND offer."active" = true
        AND offer."archivedAt" IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM "CatalogOffer" offer
      WHERE offer."productId" = product."id"
        AND offer."billingPeriod" = 'QUARTERLY'
        AND offer."active" = true
        AND offer."archivedAt" IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM "CatalogOffer" offer
      WHERE offer."productId" = product."id"
        AND offer."billingPeriod" = 'YEARLY'
        AND offer."active" = true
        AND offer."archivedAt" IS NULL
    )
  );

UPDATE "CatalogProduct" product
SET "status" = 'ARCHIVED'
WHERE product."kind" = 'TRAFFIC_PACK'
  AND product."status" = 'ACTIVE'
  AND NOT (
    EXISTS (
      SELECT 1 FROM "CatalogOffer" offer
      WHERE offer."productId" = product."id"
        AND offer."billingPeriod" = 'QUARTERLY'
        AND offer."active" = true
        AND offer."archivedAt" IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM "CatalogOffer" offer
      WHERE offer."productId" = product."id"
        AND offer."billingPeriod" = 'YEARLY'
        AND offer."active" = true
        AND offer."archivedAt" IS NULL
    )
  );
