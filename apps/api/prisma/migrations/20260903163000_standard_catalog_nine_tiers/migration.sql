BEGIN;

CREATE TEMP TABLE "_StandardCatalogOfferUrlSnapshot" ON COMMIT DROP AS
SELECT offer.id, offer."storeUrl"
FROM "CatalogOffer" AS offer
INNER JOIN "CatalogProduct" AS product ON product.id = offer."productId"
WHERE product.kind = 'PLAN'
  AND product.series = 'STANDARD';

CREATE TEMP TABLE "_StandardCatalogProductUrlSnapshot" ON COMMIT DROP AS
SELECT product.id, product."storeUrl"
FROM "CatalogProduct" AS product
WHERE product.kind = 'PLAN'
  AND product.series = 'STANDARD';

CREATE TEMP TABLE "_UltraCatalogSnapshot" ON COMMIT DROP AS
SELECT
  product.id,
  product.status,
  product."accessProfileId",
  product."sortOrder",
  product.featured,
  product."updatedAt"
FROM "CatalogProduct" AS product
WHERE product.series = 'ULTRA';

DO $$
DECLARE
  matched_products INTEGER;
  matched_offers INTEGER;
BEGIN
  SELECT COUNT(*) INTO matched_products
  FROM "CatalogProduct"
  WHERE id IN (
    'catalog_plan_092ce625dafa9850e9',
    'bf4a2ac1-a77a-4b9d-a126-724a1f9e3d7f',
    'catalog_plan_cd0834350a821c49fa',
    'catalog_plan_bf90fb70eca4148d11',
    'catalog_plan_f0e5ce428c3216f495',
    'catalog_plan_bc534fcbb40f0f9e06'
  )
    AND kind = 'PLAN'
    AND series = 'STANDARD';

  IF matched_products NOT IN (0, 6) THEN
    RAISE EXCEPTION
      'Standard catalog refresh found % of 6 expected existing products',
      matched_products;
  END IF;

  IF matched_products = 6 THEN
    SELECT COUNT(*) INTO matched_offers
    FROM "CatalogOffer" AS offer
    WHERE offer."productId" IN (
      'catalog_plan_092ce625dafa9850e9',
      'bf4a2ac1-a77a-4b9d-a126-724a1f9e3d7f',
      'catalog_plan_cd0834350a821c49fa',
      'catalog_plan_bf90fb70eca4148d11',
      'catalog_plan_f0e5ce428c3216f495',
      'catalog_plan_bc534fcbb40f0f9e06'
    )
      AND offer."billingPeriod" IN ('MONTHLY', 'QUARTERLY', 'YEARLY')
      AND offer."archivedAt" IS NULL;

    IF matched_offers <> 18 THEN
      RAISE EXCEPTION
        'Standard catalog refresh found % of 18 expected recurring offers',
        matched_offers;
    END IF;
  END IF;
END $$;

WITH targets(
  "productId", "legacyPlanId", "name", "trafficBytes",
  "monthlyPriceCents", "quarterlyPriceCents", "yearlyPriceCents", "sortOrder"
) AS (
  VALUES
    ('catalog_plan_092ce625dafa9850e9', 'cmqudmpqn00l7dona33aue7ze', 'Go', 1073741824::bigint, 200, 570, 2160, 10),
    ('bf4a2ac1-a77a-4b9d-a126-724a1f9e3d7f', 'cmt9wlm9v00mudogl7vymqtuk', 'Start', 32212254720::bigint, 890, 2537, 9612, 20),
    ('catalog_plan_cd0834350a821c49fa', 'cmqtaqduw0007doux8x3cytdh', 'Pro', 85899345920::bigint, 1290, 3677, 13932, 30),
    ('catalog_plan_bf90fb70eca4148d11', 'cmqtaste80007do6enhn0692b', 'Plus', 268435456000::bigint, 2490, 7097, 26892, 50),
    ('catalog_plan_f0e5ce428c3216f495', 'cmqtapuwb0003douxqnb69pik', 'Max', 536870912000::bigint, 4990, 14222, 53892, 70),
    ('catalog_plan_bc534fcbb40f0f9e06', 'cmqt9qa7k0000doaz6gppom92', 'Spark', 1073741824000::bigint, 7900, 22515, 85320, 90)
)
UPDATE "CatalogProduct" AS product
SET
  name = targets.name,
  "sortOrder" = targets."sortOrder",
  featured = FALSE,
  "updatedAt" = CURRENT_TIMESTAMP
FROM targets
WHERE product.id = targets."productId"
  AND product."legacyPlanId" = targets."legacyPlanId"
  AND product.kind = 'PLAN'
  AND product.series = 'STANDARD';

WITH targets(
  "productId", "trafficBytes", "billingPeriod", "priceCents", "offerName"
) AS (
  VALUES
    ('catalog_plan_092ce625dafa9850e9', 1073741824::bigint, 'MONTHLY'::"BillingPeriod", 200, '月付'),
    ('catalog_plan_092ce625dafa9850e9', 1073741824::bigint, 'QUARTERLY'::"BillingPeriod", 570, '季付 95 折'),
    ('catalog_plan_092ce625dafa9850e9', 1073741824::bigint, 'YEARLY'::"BillingPeriod", 2160, '年付 9 折'),
    ('bf4a2ac1-a77a-4b9d-a126-724a1f9e3d7f', 32212254720::bigint, 'MONTHLY'::"BillingPeriod", 890, '月付'),
    ('bf4a2ac1-a77a-4b9d-a126-724a1f9e3d7f', 32212254720::bigint, 'QUARTERLY'::"BillingPeriod", 2537, '季付 95 折'),
    ('bf4a2ac1-a77a-4b9d-a126-724a1f9e3d7f', 32212254720::bigint, 'YEARLY'::"BillingPeriod", 9612, '年付 9 折'),
    ('catalog_plan_cd0834350a821c49fa', 85899345920::bigint, 'MONTHLY'::"BillingPeriod", 1290, '月付'),
    ('catalog_plan_cd0834350a821c49fa', 85899345920::bigint, 'QUARTERLY'::"BillingPeriod", 3677, '季付 95 折'),
    ('catalog_plan_cd0834350a821c49fa', 85899345920::bigint, 'YEARLY'::"BillingPeriod", 13932, '年付 9 折'),
    ('catalog_plan_bf90fb70eca4148d11', 268435456000::bigint, 'MONTHLY'::"BillingPeriod", 2490, '月付'),
    ('catalog_plan_bf90fb70eca4148d11', 268435456000::bigint, 'QUARTERLY'::"BillingPeriod", 7097, '季付 95 折'),
    ('catalog_plan_bf90fb70eca4148d11', 268435456000::bigint, 'YEARLY'::"BillingPeriod", 26892, '年付 9 折'),
    ('catalog_plan_f0e5ce428c3216f495', 536870912000::bigint, 'MONTHLY'::"BillingPeriod", 4990, '月付'),
    ('catalog_plan_f0e5ce428c3216f495', 536870912000::bigint, 'QUARTERLY'::"BillingPeriod", 14222, '季付 95 折'),
    ('catalog_plan_f0e5ce428c3216f495', 536870912000::bigint, 'YEARLY'::"BillingPeriod", 53892, '年付 9 折'),
    ('catalog_plan_bc534fcbb40f0f9e06', 1073741824000::bigint, 'MONTHLY'::"BillingPeriod", 7900, '月付'),
    ('catalog_plan_bc534fcbb40f0f9e06', 1073741824000::bigint, 'QUARTERLY'::"BillingPeriod", 22515, '季付 95 折'),
    ('catalog_plan_bc534fcbb40f0f9e06', 1073741824000::bigint, 'YEARLY'::"BillingPeriod", 85320, '年付 9 折')
)
UPDATE "CatalogOffer" AS offer
SET
  "trafficBytes" = targets."trafficBytes",
  "priceCents" = targets."priceCents",
  name = targets."offerName",
  active = TRUE,
  "isDefault" = targets."billingPeriod" = 'MONTHLY',
  "archivedAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
FROM targets
WHERE offer."productId" = targets."productId"
  AND offer."billingPeriod" = targets."billingPeriod"
  AND offer."archivedAt" IS NULL;

WITH targets(
  "legacyPlanId", "name", "trafficBytes", "monthlyPriceCents"
) AS (
  VALUES
    ('cmqudmpqn00l7dona33aue7ze', 'Go', 1073741824::bigint, 200),
    ('cmt9wlm9v00mudogl7vymqtuk', 'Start', 32212254720::bigint, 890),
    ('cmqtaqduw0007doux8x3cytdh', 'Pro', 85899345920::bigint, 1290),
    ('cmqtaste80007do6enhn0692b', 'Plus', 268435456000::bigint, 2490),
    ('cmqtapuwb0003douxqnb69pik', 'Max', 536870912000::bigint, 4990),
    ('cmqt9qa7k0000doaz6gppom92', 'Spark', 1073741824000::bigint, 7900)
)
UPDATE "Plan" AS plan
SET
  name = targets.name,
  "trafficBytes" = targets."trafficBytes",
  "priceCents" = targets."monthlyPriceCents",
  "updatedAt" = CURRENT_TIMESTAMP
FROM targets
WHERE plan.id = targets."legacyPlanId";

UPDATE "PlanOffer" AS legacy_offer
SET
  name = offer.name,
  active = offer.active,
  "isDefault" = offer."isDefault",
  "priceCents" = offer."priceCents",
  "archivedAt" = offer."archivedAt",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "CatalogOffer" AS offer
WHERE legacy_offer.id = offer."legacyPlanOfferId"
  AND offer."productId" IN (
    'catalog_plan_092ce625dafa9850e9',
    'bf4a2ac1-a77a-4b9d-a126-724a1f9e3d7f',
    'catalog_plan_cd0834350a821c49fa',
    'catalog_plan_bf90fb70eca4148d11',
    'catalog_plan_f0e5ce428c3216f495',
    'catalog_plan_bc534fcbb40f0f9e06'
  )
  AND offer."billingPeriod" IN ('MONTHLY', 'QUARTERLY', 'YEARLY')
  AND offer."archivedAt" IS NULL;

WITH additions(
  "planId", slug, name, description, "trafficBytes", "priceCents", "sourceProductId"
) AS (
  VALUES
    ('plan-standard-boost', 'standard-boost', 'Boost', '比 Pro 更充裕，兼顾日常浏览与影音。', 161061273600::bigint, 1790, 'catalog_plan_cd0834350a821c49fa'),
    ('plan-standard-prime', 'standard-prime', 'Prime', '流量与价格更均衡，适合高频日常使用。', 375809638400::bigint, 3490, 'catalog_plan_bf90fb70eca4148d11'),
    ('plan-standard-elite', 'standard-elite', 'Elite', '介于 Max 与 Spark 之间的高流量档位。', 805306368000::bigint, 6490, 'catalog_plan_f0e5ce428c3216f495')
)
INSERT INTO "Plan" (
  id, slug, name, description, active, "trafficBytes", "durationDays",
  "speedUpMbps", "speedDownMbps", "deviceLimit", "priceCents", accent,
  "accessProfileId", "createdAt", "updatedAt"
)
SELECT
  additions."planId",
  additions.slug,
  additions.name,
  additions.description,
  TRUE,
  additions."trafficBytes",
  30,
  profile."speedUpMbps",
  profile."speedDownMbps",
  profile."deviceLimit",
  additions."priceCents",
  'green',
  source."accessProfileId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM additions
INNER JOIN "CatalogProduct" AS source ON source.id = additions."sourceProductId"
INNER JOIN "AccessProfile" AS profile ON profile.id = source."accessProfileId";

WITH additions(
  id, "planId", slug, name, "billingPeriod", "intervalMonths", "priceCents", "isDefault"
) AS (
  VALUES
    ('plan-offer-boost-monthly', 'plan-standard-boost', 'standard-boost-monthly', '月付', 'MONTHLY'::"BillingPeriod", 1, 1790, TRUE),
    ('plan-offer-boost-quarterly', 'plan-standard-boost', 'standard-boost-quarterly', '季付 95 折', 'QUARTERLY'::"BillingPeriod", 3, 5102, FALSE),
    ('plan-offer-boost-yearly', 'plan-standard-boost', 'standard-boost-yearly', '年付 9 折', 'YEARLY'::"BillingPeriod", 12, 19332, FALSE),
    ('plan-offer-prime-monthly', 'plan-standard-prime', 'standard-prime-monthly', '月付', 'MONTHLY'::"BillingPeriod", 1, 3490, TRUE),
    ('plan-offer-prime-quarterly', 'plan-standard-prime', 'standard-prime-quarterly', '季付 95 折', 'QUARTERLY'::"BillingPeriod", 3, 9947, FALSE),
    ('plan-offer-prime-yearly', 'plan-standard-prime', 'standard-prime-yearly', '年付 9 折', 'YEARLY'::"BillingPeriod", 12, 37692, FALSE),
    ('plan-offer-elite-monthly', 'plan-standard-elite', 'standard-elite-monthly', '月付', 'MONTHLY'::"BillingPeriod", 1, 6490, TRUE),
    ('plan-offer-elite-quarterly', 'plan-standard-elite', 'standard-elite-quarterly', '季付 95 折', 'QUARTERLY'::"BillingPeriod", 3, 18497, FALSE),
    ('plan-offer-elite-yearly', 'plan-standard-elite', 'standard-elite-yearly', '年付 9 折', 'YEARLY'::"BillingPeriod", 12, 70092, FALSE)
)
INSERT INTO "PlanOffer" (
  id, "planId", slug, name, active, "isDefault", "billingPeriod",
  "intervalMonths", "legacyDurationDays", "priceCents", "archivedAt",
  "createdAt", "updatedAt"
)
SELECT
  additions.id,
  additions."planId",
  additions.slug,
  additions.name,
  TRUE,
  additions."isDefault",
  additions."billingPeriod",
  additions."intervalMonths",
  NULL,
  additions."priceCents",
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM additions
INNER JOIN "Plan" AS plan ON plan.id = additions."planId";

WITH additions(
  "productId", "legacyPlanId", slug, name, description, "sortOrder", featured
) AS (
  VALUES
    ('catalog-standard-boost', 'plan-standard-boost', 'standard-boost', 'Boost', '比 Pro 更充裕，兼顾日常浏览与影音。', 40, FALSE),
    ('catalog-standard-prime', 'plan-standard-prime', 'standard-prime', 'Prime', '流量与价格更均衡，适合高频日常使用。', 60, TRUE),
    ('catalog-standard-elite', 'plan-standard-elite', 'standard-elite', 'Elite', '介于 Max 与 Spark 之间的高流量档位。', 80, FALSE)
)
INSERT INTO "CatalogProduct" (
  id, "legacyPlanId", slug, kind, series, status, name, description,
  "storeUrl", "quotaCadence", "accessProfileId", "speedUpMbps",
  "speedDownMbps", "defaultTrafficMultiplierBasisPoints", accent,
  "sortOrder", featured, "purchaseLimitPerUser", "purchaseLimitKey",
  "requiresActivePlan", "referralEligible", "systemManaged", "createdAt", "updatedAt"
)
SELECT
  additions."productId",
  additions."legacyPlanId",
  additions.slug,
  'PLAN'::"CatalogProductKind",
  'STANDARD'::"CatalogProductSeries",
  'ACTIVE'::"CatalogProductStatus",
  additions.name,
  additions.description,
  NULL,
  'MONTHLY_RESET'::"QuotaCadence",
  plan."accessProfileId",
  plan."speedUpMbps",
  plan."speedDownMbps",
  21000,
  'green',
  additions."sortOrder",
  additions.featured,
  NULL,
  NULL,
  FALSE,
  TRUE,
  FALSE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM additions
INNER JOIN "Plan" AS plan ON plan.id = additions."legacyPlanId";

WITH additions(
  id, "productId", "legacyPlanOfferId", slug, name, "billingPeriod",
  "intervalMonths", "trafficBytes", "priceCents", "isDefault"
) AS (
  VALUES
    ('catalog-offer-standard-boost-monthly', 'catalog-standard-boost', 'plan-offer-boost-monthly', 'standard-boost-monthly', '月付', 'MONTHLY'::"BillingPeriod", 1, 161061273600::bigint, 1790, TRUE),
    ('catalog-offer-standard-boost-quarterly', 'catalog-standard-boost', 'plan-offer-boost-quarterly', 'standard-boost-quarterly', '季付 95 折', 'QUARTERLY'::"BillingPeriod", 3, 161061273600::bigint, 5102, FALSE),
    ('catalog-offer-standard-boost-yearly', 'catalog-standard-boost', 'plan-offer-boost-yearly', 'standard-boost-yearly', '年付 9 折', 'YEARLY'::"BillingPeriod", 12, 161061273600::bigint, 19332, FALSE),
    ('catalog-offer-standard-prime-monthly', 'catalog-standard-prime', 'plan-offer-prime-monthly', 'standard-prime-monthly', '月付', 'MONTHLY'::"BillingPeriod", 1, 375809638400::bigint, 3490, TRUE),
    ('catalog-offer-standard-prime-quarterly', 'catalog-standard-prime', 'plan-offer-prime-quarterly', 'standard-prime-quarterly', '季付 95 折', 'QUARTERLY'::"BillingPeriod", 3, 375809638400::bigint, 9947, FALSE),
    ('catalog-offer-standard-prime-yearly', 'catalog-standard-prime', 'plan-offer-prime-yearly', 'standard-prime-yearly', '年付 9 折', 'YEARLY'::"BillingPeriod", 12, 375809638400::bigint, 37692, FALSE),
    ('catalog-offer-standard-elite-monthly', 'catalog-standard-elite', 'plan-offer-elite-monthly', 'standard-elite-monthly', '月付', 'MONTHLY'::"BillingPeriod", 1, 805306368000::bigint, 6490, TRUE),
    ('catalog-offer-standard-elite-quarterly', 'catalog-standard-elite', 'plan-offer-elite-quarterly', 'standard-elite-quarterly', '季付 95 折', 'QUARTERLY'::"BillingPeriod", 3, 805306368000::bigint, 18497, FALSE),
    ('catalog-offer-standard-elite-yearly', 'catalog-standard-elite', 'plan-offer-elite-yearly', 'standard-elite-yearly', '年付 9 折', 'YEARLY'::"BillingPeriod", 12, 805306368000::bigint, 70092, FALSE)
)
INSERT INTO "CatalogOffer" (
  id, "productId", "legacyPlanOfferId", slug, name, "billingPeriod",
  "intervalMonths", "trafficBytes", "priceCents", "storeUrl", currency,
  active, "isDefault", "archivedAt", "createdAt", "updatedAt"
)
SELECT
  additions.id,
  additions."productId",
  additions."legacyPlanOfferId",
  additions.slug,
  additions.name,
  additions."billingPeriod",
  additions."intervalMonths",
  additions."trafficBytes",
  additions."priceCents",
  NULL,
  'CNY',
  TRUE,
  additions."isDefault",
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM additions
INNER JOIN "CatalogProduct" AS product ON product.id = additions."productId"
INNER JOIN "PlanOffer" AS legacy_offer ON legacy_offer.id = additions."legacyPlanOfferId";

DO $$
DECLARE
  standard_products INTEGER;
  standard_offers INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "_StandardCatalogOfferUrlSnapshot" AS snapshot
    INNER JOIN "CatalogOffer" AS offer ON offer.id = snapshot.id
    WHERE offer."storeUrl" IS DISTINCT FROM snapshot."storeUrl"
  ) THEN
    RAISE EXCEPTION 'Standard catalog refresh changed an existing offer store URL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "_StandardCatalogProductUrlSnapshot" AS snapshot
    INNER JOIN "CatalogProduct" AS product ON product.id = snapshot.id
    WHERE product."storeUrl" IS DISTINCT FROM snapshot."storeUrl"
  ) THEN
    RAISE EXCEPTION 'Standard catalog refresh changed an existing product store URL';
  END IF;

  IF EXISTS (
    (SELECT * FROM "_UltraCatalogSnapshot"
     EXCEPT
     SELECT
       product.id,
       product.status,
       product."accessProfileId",
       product."sortOrder",
       product.featured,
       product."updatedAt"
     FROM "CatalogProduct" AS product
     WHERE product.series = 'ULTRA')
    UNION ALL
    (SELECT
       product.id,
       product.status,
       product."accessProfileId",
       product."sortOrder",
       product.featured,
       product."updatedAt"
     FROM "CatalogProduct" AS product
     WHERE product.series = 'ULTRA'
     EXCEPT
     SELECT * FROM "_UltraCatalogSnapshot")
  ) THEN
    RAISE EXCEPTION 'Standard catalog refresh changed the Ultra catalog';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CatalogProduct"
    WHERE id = 'catalog-standard-boost'
  ) THEN
    SELECT COUNT(*) INTO standard_products
    FROM "CatalogProduct"
    WHERE id IN (
      'catalog_plan_092ce625dafa9850e9',
      'bf4a2ac1-a77a-4b9d-a126-724a1f9e3d7f',
      'catalog_plan_cd0834350a821c49fa',
      'catalog-standard-boost',
      'catalog_plan_bf90fb70eca4148d11',
      'catalog-standard-prime',
      'catalog_plan_f0e5ce428c3216f495',
      'catalog-standard-elite',
      'catalog_plan_bc534fcbb40f0f9e06'
    )
      AND kind = 'PLAN'
      AND series = 'STANDARD'
      AND status = 'ACTIVE';

    SELECT COUNT(*) INTO standard_offers
    FROM "CatalogOffer" AS offer
    WHERE offer."productId" IN (
      'catalog_plan_092ce625dafa9850e9',
      'bf4a2ac1-a77a-4b9d-a126-724a1f9e3d7f',
      'catalog_plan_cd0834350a821c49fa',
      'catalog-standard-boost',
      'catalog_plan_bf90fb70eca4148d11',
      'catalog-standard-prime',
      'catalog_plan_f0e5ce428c3216f495',
      'catalog-standard-elite',
      'catalog_plan_bc534fcbb40f0f9e06'
    )
      AND offer."billingPeriod" IN ('MONTHLY', 'QUARTERLY', 'YEARLY')
      AND offer.active = TRUE
      AND offer."archivedAt" IS NULL;

    IF standard_products <> 9 OR standard_offers <> 27 THEN
      RAISE EXCEPTION
        'Standard catalog refresh produced % products and % recurring offers',
        standard_products,
        standard_offers;
    END IF;
  END IF;
END $$;

COMMIT;
