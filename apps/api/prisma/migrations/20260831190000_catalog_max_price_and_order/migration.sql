BEGIN;

CREATE TEMP TABLE "_CatalogMaxOfferStoreUrlSnapshot" ON COMMIT DROP AS
SELECT "id", "storeUrl"
FROM "CatalogOffer"
WHERE "productId" = 'catalog_plan_f0e5ce428c3216f495';

DO $$
DECLARE
  matched_products INTEGER;
  matched_max_offers INTEGER;
BEGIN
  SELECT COUNT(*) INTO matched_products
  FROM "CatalogProduct"
  WHERE "id" IN (
    'catalog_plan_092ce625dafa9850e9',
    'bf4a2ac1-a77a-4b9d-a126-724a1f9e3d7f',
    'catalog_plan_cd0834350a821c49fa',
    'catalog_plan_bf90fb70eca4148d11',
    'catalog_plan_f0e5ce428c3216f495',
    'catalog_plan_bc534fcbb40f0f9e06'
  );

  IF matched_products NOT IN (0, 6) THEN
    RAISE EXCEPTION 'Catalog order repair found % of 6 expected products', matched_products;
  END IF;

  IF matched_products = 6 THEN
    SELECT COUNT(*) INTO matched_max_offers
    FROM "CatalogOffer"
    WHERE "productId" = 'catalog_plan_f0e5ce428c3216f495'
      AND "billingPeriod" IN ('MONTHLY', 'QUARTERLY', 'YEARLY')
      AND "archivedAt" IS NULL;

    IF matched_max_offers <> 3 THEN
      RAISE EXCEPTION 'Max price repair found % of 3 expected offers', matched_max_offers;
    END IF;
  END IF;
END $$;

WITH prices("billingPeriod", "priceCents") AS (
  VALUES
    ('MONTHLY'::"BillingPeriod", 4590),
    ('QUARTERLY'::"BillingPeriod", 13082),
    ('YEARLY'::"BillingPeriod", 49572)
)
UPDATE "CatalogOffer" AS offer
SET
  "priceCents" = prices."priceCents",
  "updatedAt" = CURRENT_TIMESTAMP
FROM prices
WHERE offer."productId" = 'catalog_plan_f0e5ce428c3216f495'
  AND offer."billingPeriod" = prices."billingPeriod"
  AND offer."archivedAt" IS NULL;

UPDATE "PlanOffer" AS legacy_offer
SET
  "priceCents" = offer."priceCents",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "CatalogOffer" AS offer
WHERE legacy_offer."id" = offer."legacyPlanOfferId"
  AND offer."productId" = 'catalog_plan_f0e5ce428c3216f495'
  AND offer."archivedAt" IS NULL;

UPDATE "Plan"
SET
  "priceCents" = 4590,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'cmqtapuwb0003douxqnb69pik';

UPDATE "PlanOffer"
SET
  "priceCents" = 4590,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "planId" = 'cmqtapuwb0003douxqnb69pik'
  AND "billingPeriod" = 'LEGACY';

WITH plan_order("productId", "sortOrder") AS (
  VALUES
    ('catalog_plan_092ce625dafa9850e9', 10),
    ('bf4a2ac1-a77a-4b9d-a126-724a1f9e3d7f', 20),
    ('catalog_plan_cd0834350a821c49fa', 30),
    ('catalog_plan_bf90fb70eca4148d11', 40),
    ('catalog_plan_f0e5ce428c3216f495', 50),
    ('catalog_plan_bc534fcbb40f0f9e06', 60)
)
UPDATE "CatalogProduct" AS product
SET
  "sortOrder" = plan_order."sortOrder",
  "updatedAt" = CURRENT_TIMESTAMP
FROM plan_order
WHERE product."id" = plan_order."productId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "_CatalogMaxOfferStoreUrlSnapshot" AS snapshot
    JOIN "CatalogOffer" AS offer ON offer."id" = snapshot."id"
    WHERE offer."storeUrl" IS DISTINCT FROM snapshot."storeUrl"
  ) THEN
    RAISE EXCEPTION 'Max price repair changed an offer store URL';
  END IF;
END $$;

COMMIT;
