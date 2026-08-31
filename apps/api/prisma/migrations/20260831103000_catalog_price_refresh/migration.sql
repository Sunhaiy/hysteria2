BEGIN;

CREATE TEMP TABLE "_CatalogOfferStoreUrlSnapshot" ON COMMIT DROP AS
SELECT "id", "storeUrl"
FROM "CatalogOffer"
WHERE "productId" IN (
  'catalog_plan_cd0834350a821c49fa',
  'catalog_plan_bf90fb70eca4148d11',
  'catalog_plan_bc534fcbb40f0f9e06'
);

DO $$
DECLARE
  matched_products INTEGER;
  matched_offers INTEGER;
BEGIN
  SELECT COUNT(*) INTO matched_products
  FROM "CatalogProduct"
  WHERE "id" IN (
    'catalog_plan_cd0834350a821c49fa',
    'catalog_plan_bf90fb70eca4148d11',
    'catalog_plan_bc534fcbb40f0f9e06'
  );

  IF matched_products NOT IN (0, 3) THEN
    RAISE EXCEPTION 'Catalog price refresh found % of 3 expected products', matched_products;
  END IF;

  IF matched_products = 3 THEN
    SELECT COUNT(*) INTO matched_offers
    FROM "CatalogOffer"
    WHERE "productId" IN (
      'catalog_plan_cd0834350a821c49fa',
      'catalog_plan_bf90fb70eca4148d11',
      'catalog_plan_bc534fcbb40f0f9e06'
    )
      AND "billingPeriod" IN ('MONTHLY', 'QUARTERLY', 'YEARLY')
      AND "archivedAt" IS NULL;

    IF matched_offers <> 9 THEN
      RAISE EXCEPTION 'Catalog price refresh found % of 9 expected offers', matched_offers;
    END IF;
  END IF;
END $$;

WITH prices("productId", "billingPeriod", "priceCents") AS (
  VALUES
    ('catalog_plan_cd0834350a821c49fa', 'MONTHLY'::"BillingPeriod", 1290),
    ('catalog_plan_cd0834350a821c49fa', 'QUARTERLY'::"BillingPeriod", 3677),
    ('catalog_plan_cd0834350a821c49fa', 'YEARLY'::"BillingPeriod", 13932),
    ('catalog_plan_bf90fb70eca4148d11', 'MONTHLY'::"BillingPeriod", 2100),
    ('catalog_plan_bf90fb70eca4148d11', 'QUARTERLY'::"BillingPeriod", 5985),
    ('catalog_plan_bf90fb70eca4148d11', 'YEARLY'::"BillingPeriod", 22680),
    ('catalog_plan_bc534fcbb40f0f9e06', 'MONTHLY'::"BillingPeriod", 7200),
    ('catalog_plan_bc534fcbb40f0f9e06', 'QUARTERLY'::"BillingPeriod", 20520),
    ('catalog_plan_bc534fcbb40f0f9e06', 'YEARLY'::"BillingPeriod", 77760)
)
UPDATE "CatalogOffer" AS offer
SET
  "priceCents" = prices."priceCents",
  "updatedAt" = CURRENT_TIMESTAMP
FROM prices
WHERE offer."productId" = prices."productId"
  AND offer."billingPeriod" = prices."billingPeriod"
  AND offer."archivedAt" IS NULL;

UPDATE "PlanOffer" AS legacy_offer
SET
  "priceCents" = offer."priceCents",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "CatalogOffer" AS offer
WHERE legacy_offer."id" = offer."legacyPlanOfferId"
  AND offer."productId" IN (
    'catalog_plan_cd0834350a821c49fa',
    'catalog_plan_bf90fb70eca4148d11',
    'catalog_plan_bc534fcbb40f0f9e06'
  )
  AND offer."archivedAt" IS NULL;

WITH monthly_prices("planId", "priceCents") AS (
  VALUES
    ('cmqtaqduw0007doux8x3cytdh', 1290),
    ('cmqtaste80007do6enhn0692b', 2100),
    ('cmqt9qa7k0000doaz6gppom92', 7200)
)
UPDATE "Plan" AS plan
SET
  "priceCents" = monthly_prices."priceCents",
  "updatedAt" = CURRENT_TIMESTAMP
FROM monthly_prices
WHERE plan."id" = monthly_prices."planId";

WITH monthly_prices("planId", "priceCents") AS (
  VALUES
    ('cmqtaqduw0007doux8x3cytdh', 1290),
    ('cmqtaste80007do6enhn0692b', 2100),
    ('cmqt9qa7k0000doaz6gppom92', 7200)
)
UPDATE "PlanOffer" AS legacy_offer
SET
  "priceCents" = monthly_prices."priceCents",
  "updatedAt" = CURRENT_TIMESTAMP
FROM monthly_prices
WHERE legacy_offer."planId" = monthly_prices."planId"
  AND legacy_offer."billingPeriod" = 'LEGACY';

UPDATE "CatalogOffer"
SET
  "trafficBytes" = 1099511627776,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "productId" = 'catalog_plan_bc534fcbb40f0f9e06'
  AND "archivedAt" IS NULL;

UPDATE "Plan"
SET
  "trafficBytes" = 1099511627776,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'cmqt9qa7k0000doaz6gppom92';

UPDATE "Subscription"
SET
  "includedTrafficBytes" = 1099511627776,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "planId" = 'cmqt9qa7k0000doaz6gppom92'
  AND "status" = 'ACTIVE'
  AND "endsAt" > CURRENT_TIMESTAMP;

UPDATE "SubscriptionCycle" AS cycle
SET
  "grantedBytes" = 1099511627776,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Subscription" AS subscription
WHERE cycle."subscriptionId" = subscription."id"
  AND subscription."planId" = 'cmqt9qa7k0000doaz6gppom92'
  AND subscription."status" = 'ACTIVE'
  AND subscription."endsAt" > CURRENT_TIMESTAMP
  AND cycle."endsAt" > CURRENT_TIMESTAMP;

UPDATE "QuotaBucket" AS bucket
SET
  "grantedBytes" = 1099511627776,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "EntitlementGrant" AS grant
WHERE bucket."grantId" = grant."id"
  AND grant."productId" = 'catalog_plan_bc534fcbb40f0f9e06'
  AND grant."kind" = 'PLAN'
  AND grant."status" = 'ACTIVE'
  AND grant."endsAt" > CURRENT_TIMESTAMP
  AND bucket."endsAt" > CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "_CatalogOfferStoreUrlSnapshot" AS snapshot
    JOIN "CatalogOffer" AS offer ON offer."id" = snapshot."id"
    WHERE offer."storeUrl" IS DISTINCT FROM snapshot."storeUrl"
  ) THEN
    RAISE EXCEPTION 'Catalog price refresh changed a store URL';
  END IF;
END $$;

COMMIT;
