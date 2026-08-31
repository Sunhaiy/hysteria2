BEGIN;

CREATE TEMP TABLE "_CatalogTrafficStoreUrlSnapshot" ON COMMIT DROP AS
SELECT offer."id", offer."storeUrl"
FROM "CatalogOffer" AS offer
WHERE offer."productId" IN (
  'catalog_plan_092ce625dafa9850e9',
  'bf4a2ac1-a77a-4b9d-a126-724a1f9e3d7f',
  'catalog_plan_cd0834350a821c49fa',
  'catalog_plan_bf90fb70eca4148d11',
  'catalog_plan_f0e5ce428c3216f495',
  'catalog_plan_bc534fcbb40f0f9e06',
  '3b2491c6-c73d-42a7-bf11-5dc7de105d57',
  'bb0cc95a-d477-487e-8927-239b700c9442',
  '319f1b54-8aa4-4ccf-b438-3c486363b1f6',
  '429af602-3257-4895-b7e1-acc70f0ecc0d',
  '39193509-6de4-4078-a883-13dbd0bf5126',
  '6f74602f-e9c0-4c33-a2e9-f06ce3a966ff'
);

CREATE TEMP TABLE "_CatalogProductStoreUrlSnapshot" ON COMMIT DROP AS
SELECT product."id", product."storeUrl"
FROM "CatalogProduct" AS product
WHERE product."id" IN (
  'catalog_plan_092ce625dafa9850e9',
  'bf4a2ac1-a77a-4b9d-a126-724a1f9e3d7f',
  'catalog_plan_cd0834350a821c49fa',
  'catalog_plan_bf90fb70eca4148d11',
  'catalog_plan_f0e5ce428c3216f495',
  'catalog_plan_bc534fcbb40f0f9e06',
  '3b2491c6-c73d-42a7-bf11-5dc7de105d57',
  'bb0cc95a-d477-487e-8927-239b700c9442',
  '319f1b54-8aa4-4ccf-b438-3c486363b1f6',
  '429af602-3257-4895-b7e1-acc70f0ecc0d',
  '39193509-6de4-4078-a883-13dbd0bf5126',
  '6f74602f-e9c0-4c33-a2e9-f06ce3a966ff'
);

DO $$
DECLARE
  matched_plans INTEGER;
  matched_packs INTEGER;
  matched_pack_offers INTEGER;
BEGIN
  SELECT COUNT(*) INTO matched_plans
  FROM "CatalogProduct"
  WHERE "id" IN (
    'catalog_plan_092ce625dafa9850e9',
    'bf4a2ac1-a77a-4b9d-a126-724a1f9e3d7f',
    'catalog_plan_cd0834350a821c49fa',
    'catalog_plan_bf90fb70eca4148d11',
    'catalog_plan_f0e5ce428c3216f495',
    'catalog_plan_bc534fcbb40f0f9e06'
  ) AND "kind" = 'PLAN';

  SELECT COUNT(*) INTO matched_packs
  FROM "CatalogProduct"
  WHERE "id" IN (
    '3b2491c6-c73d-42a7-bf11-5dc7de105d57',
    'bb0cc95a-d477-487e-8927-239b700c9442',
    '319f1b54-8aa4-4ccf-b438-3c486363b1f6',
    '429af602-3257-4895-b7e1-acc70f0ecc0d',
    '39193509-6de4-4078-a883-13dbd0bf5126',
    '6f74602f-e9c0-4c33-a2e9-f06ce3a966ff'
  ) AND "kind" = 'TRAFFIC_PACK';

  IF matched_plans NOT IN (0, 6) THEN
    RAISE EXCEPTION 'Catalog traffic refresh found % of 6 expected plans', matched_plans;
  END IF;
  IF matched_packs NOT IN (0, 6) THEN
    RAISE EXCEPTION 'Catalog traffic refresh found % of 6 expected packs', matched_packs;
  END IF;
  IF matched_plans <> matched_packs THEN
    RAISE EXCEPTION 'Catalog traffic refresh requires the complete production catalog';
  END IF;

  IF matched_packs = 6 THEN
    SELECT COUNT(*) INTO matched_pack_offers
    FROM "CatalogOffer"
    WHERE "id" IN (
      'cmt8ii98p001wdobjgl78zyb4',
      'cmt8ii98p001xdobjm0kzzx9t',
      'cmt8ii9920026dobje7m5tapq',
      'cmt8ii9920027dobj4wngmz0n',
      'cmt8ii999002gdobjxhjznlgc',
      'cmt8ii999002hdobj00vlqtt7',
      'cmt8ii99g002qdobj75n2sfob',
      'cmt8ii99g002rdobjflgv7apy',
      'cmt8ii99m0030dobjkpog9npo',
      'cmt8ii99m0031dobjc93o7ih9',
      'cmt8ii99s003adobjo16o2d1m',
      'cmt8ii99s003bdobj93tpp6mq'
    ) AND "archivedAt" IS NULL;
    IF matched_pack_offers <> 12 THEN
      RAISE EXCEPTION 'Catalog traffic refresh found % of 12 expected pack offers', matched_pack_offers;
    END IF;
  END IF;
END $$;

WITH plan_traffic("productId", "planId", "trafficBytes") AS (
  VALUES
    ('catalog_plan_092ce625dafa9850e9', 'cmqudmpqn00l7dona33aue7ze', 3221225472::bigint),
    ('bf4a2ac1-a77a-4b9d-a126-724a1f9e3d7f', 'cmt9wlm9v00mudogl7vymqtuk', 53687091200::bigint),
    ('catalog_plan_cd0834350a821c49fa', 'cmqtaqduw0007doux8x3cytdh', 128849018880::bigint),
    ('catalog_plan_bf90fb70eca4148d11', 'cmqtaste80007do6enhn0692b', 322122547200::bigint),
    ('catalog_plan_f0e5ce428c3216f495', 'cmqtapuwb0003douxqnb69pik', 644245094400::bigint),
    ('catalog_plan_bc534fcbb40f0f9e06', 'cmqt9qa7k0000doaz6gppom92', 1099511627776::bigint)
)
UPDATE "CatalogOffer" AS offer
SET "trafficBytes" = plan_traffic."trafficBytes", "updatedAt" = CURRENT_TIMESTAMP
FROM plan_traffic
WHERE offer."productId" = plan_traffic."productId"
  AND offer."archivedAt" IS NULL;

WITH plan_traffic("productId", "planId", "trafficBytes") AS (
  VALUES
    ('catalog_plan_092ce625dafa9850e9', 'cmqudmpqn00l7dona33aue7ze', 3221225472::bigint),
    ('bf4a2ac1-a77a-4b9d-a126-724a1f9e3d7f', 'cmt9wlm9v00mudogl7vymqtuk', 53687091200::bigint),
    ('catalog_plan_cd0834350a821c49fa', 'cmqtaqduw0007doux8x3cytdh', 128849018880::bigint),
    ('catalog_plan_bf90fb70eca4148d11', 'cmqtaste80007do6enhn0692b', 322122547200::bigint),
    ('catalog_plan_f0e5ce428c3216f495', 'cmqtapuwb0003douxqnb69pik', 644245094400::bigint),
    ('catalog_plan_bc534fcbb40f0f9e06', 'cmqt9qa7k0000doaz6gppom92', 1099511627776::bigint)
)
UPDATE "Plan" AS plan
SET "trafficBytes" = plan_traffic."trafficBytes", "updatedAt" = CURRENT_TIMESTAMP
FROM plan_traffic
WHERE plan."id" = plan_traffic."planId";

WITH packs(
  "productId", "legacyProductId", "oneTimeOfferId", "yearlyOfferId",
  "name", "trafficBytes", "priceCents"
) AS (
  VALUES
    ('3b2491c6-c73d-42a7-bf11-5dc7de105d57', 'cmt8ii98l001vdobjxx2okf21', 'cmt8ii98p001wdobjgl78zyb4', 'cmt8ii98p001xdobjm0kzzx9t', '10GB 流量包', 10737418240::bigint, 690),
    ('bb0cc95a-d477-487e-8927-239b700c9442', 'cmt8ii9900025dobjvhk9o99u', 'cmt8ii9920026dobje7m5tapq', 'cmt8ii9920027dobj4wngmz0n', '30GB 流量包', 32212254720::bigint, 1950),
    ('319f1b54-8aa4-4ccf-b438-3c486363b1f6', 'cmt8ii997002fdobjd4zacp3t', 'cmt8ii999002gdobjxhjznlgc', 'cmt8ii999002hdobj00vlqtt7', '50GB 流量包', 53687091200::bigint, 3200),
    ('429af602-3257-4895-b7e1-acc70f0ecc0d', 'cmt8ii99e002pdobjk10rzyfi', 'cmt8ii99g002qdobj75n2sfob', 'cmt8ii99g002rdobjflgv7apy', '100GB 流量包', 107374182400::bigint, 6200),
    ('39193509-6de4-4078-a883-13dbd0bf5126', 'cmt8ii99l002zdobj4nb1y4fi', 'cmt8ii99m0030dobjkpog9npo', 'cmt8ii99m0031dobjc93o7ih9', '200GB 流量包', 214748364800::bigint, 12200),
    ('6f74602f-e9c0-4c33-a2e9-f06ce3a966ff', 'cmt8ii99r0039dobj0oa4f5re', 'cmt8ii99s003adobjo16o2d1m', 'cmt8ii99s003bdobj93tpp6mq', '500GB 流量包', 536870912000::bigint, 30000)
)
UPDATE "CatalogProduct" AS product
SET
  "name" = packs."name",
  "description" = '一次购买永久有效，可独立使用所选节点',
  "requiresActivePlan" = false,
  "updatedAt" = CURRENT_TIMESTAMP
FROM packs
WHERE product."id" = packs."productId";

WITH packs(
  "productId", "legacyProductId", "oneTimeOfferId", "yearlyOfferId",
  "name", "trafficBytes", "priceCents"
) AS (
  VALUES
    ('3b2491c6-c73d-42a7-bf11-5dc7de105d57', 'cmt8ii98l001vdobjxx2okf21', 'cmt8ii98p001wdobjgl78zyb4', 'cmt8ii98p001xdobjm0kzzx9t', '10GB 流量包', 10737418240::bigint, 690),
    ('bb0cc95a-d477-487e-8927-239b700c9442', 'cmt8ii9900025dobjvhk9o99u', 'cmt8ii9920026dobje7m5tapq', 'cmt8ii9920027dobj4wngmz0n', '30GB 流量包', 32212254720::bigint, 1950),
    ('319f1b54-8aa4-4ccf-b438-3c486363b1f6', 'cmt8ii997002fdobjd4zacp3t', 'cmt8ii999002gdobjxhjznlgc', 'cmt8ii999002hdobj00vlqtt7', '50GB 流量包', 53687091200::bigint, 3200),
    ('429af602-3257-4895-b7e1-acc70f0ecc0d', 'cmt8ii99e002pdobjk10rzyfi', 'cmt8ii99g002qdobj75n2sfob', 'cmt8ii99g002rdobjflgv7apy', '100GB 流量包', 107374182400::bigint, 6200),
    ('39193509-6de4-4078-a883-13dbd0bf5126', 'cmt8ii99l002zdobj4nb1y4fi', 'cmt8ii99m0030dobjkpog9npo', 'cmt8ii99m0031dobjc93o7ih9', '200GB 流量包', 214748364800::bigint, 12200),
    ('6f74602f-e9c0-4c33-a2e9-f06ce3a966ff', 'cmt8ii99r0039dobj0oa4f5re', 'cmt8ii99s003adobjo16o2d1m', 'cmt8ii99s003bdobj93tpp6mq', '500GB 流量包', 536870912000::bigint, 30000)
)
UPDATE "TrafficPackProduct" AS product
SET
  "name" = packs."name",
  "description" = '一次购买永久有效，可独立使用所选节点',
  "trafficBytes" = packs."trafficBytes",
  "validityDays" = NULL,
  "priceCents" = packs."priceCents",
  "updatedAt" = CURRENT_TIMESTAMP
FROM packs
WHERE product."id" = packs."legacyProductId";

WITH packs(
  "productId", "legacyProductId", "oneTimeOfferId", "yearlyOfferId",
  "name", "trafficBytes", "priceCents"
) AS (
  VALUES
    ('3b2491c6-c73d-42a7-bf11-5dc7de105d57', 'cmt8ii98l001vdobjxx2okf21', 'cmt8ii98p001wdobjgl78zyb4', 'cmt8ii98p001xdobjm0kzzx9t', '10GB 流量包', 10737418240::bigint, 690),
    ('bb0cc95a-d477-487e-8927-239b700c9442', 'cmt8ii9900025dobjvhk9o99u', 'cmt8ii9920026dobje7m5tapq', 'cmt8ii9920027dobj4wngmz0n', '30GB 流量包', 32212254720::bigint, 1950),
    ('319f1b54-8aa4-4ccf-b438-3c486363b1f6', 'cmt8ii997002fdobjd4zacp3t', 'cmt8ii999002gdobjxhjznlgc', 'cmt8ii999002hdobj00vlqtt7', '50GB 流量包', 53687091200::bigint, 3200),
    ('429af602-3257-4895-b7e1-acc70f0ecc0d', 'cmt8ii99e002pdobjk10rzyfi', 'cmt8ii99g002qdobj75n2sfob', 'cmt8ii99g002rdobjflgv7apy', '100GB 流量包', 107374182400::bigint, 6200),
    ('39193509-6de4-4078-a883-13dbd0bf5126', 'cmt8ii99l002zdobj4nb1y4fi', 'cmt8ii99m0030dobjkpog9npo', 'cmt8ii99m0031dobjc93o7ih9', '200GB 流量包', 214748364800::bigint, 12200),
    ('6f74602f-e9c0-4c33-a2e9-f06ce3a966ff', 'cmt8ii99r0039dobj0oa4f5re', 'cmt8ii99s003adobjo16o2d1m', 'cmt8ii99s003bdobj93tpp6mq', '500GB 流量包', 536870912000::bigint, 30000)
)
UPDATE "CatalogOffer" AS offer
SET
  "name" = '一次性',
  "billingPeriod" = 'ONE_TIME',
  "intervalMonths" = NULL,
  "trafficBytes" = packs."trafficBytes",
  "priceCents" = packs."priceCents",
  "active" = true,
  "isDefault" = true,
  "archivedAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
FROM packs
WHERE offer."id" = packs."oneTimeOfferId";

WITH packs("yearlyOfferId") AS (
  VALUES
    ('cmt8ii98p001xdobjm0kzzx9t'),
    ('cmt8ii9920027dobj4wngmz0n'),
    ('cmt8ii999002hdobj00vlqtt7'),
    ('cmt8ii99g002rdobjflgv7apy'),
    ('cmt8ii99m0031dobjc93o7ih9'),
    ('cmt8ii99s003bdobj93tpp6mq')
)
UPDATE "CatalogOffer" AS offer
SET
  "active" = false,
  "isDefault" = false,
  "archivedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
FROM packs
WHERE offer."id" = packs."yearlyOfferId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "_CatalogTrafficStoreUrlSnapshot" AS snapshot
    JOIN "CatalogOffer" AS offer ON offer."id" = snapshot."id"
    WHERE offer."storeUrl" IS DISTINCT FROM snapshot."storeUrl"
  ) THEN
    RAISE EXCEPTION 'Catalog traffic refresh changed an offer store URL';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "_CatalogProductStoreUrlSnapshot" AS snapshot
    JOIN "CatalogProduct" AS product ON product."id" = snapshot."id"
    WHERE product."storeUrl" IS DISTINCT FROM snapshot."storeUrl"
  ) THEN
    RAISE EXCEPTION 'Catalog traffic refresh changed a product store URL';
  END IF;
END $$;

COMMIT;
