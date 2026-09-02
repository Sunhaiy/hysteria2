-- Expand the catalog and entitlement ledgers for additive permanent Ultra plans.
CREATE TYPE "CatalogProductSeries" AS ENUM ('STANDARD', 'ULTRA');

ALTER TABLE "CatalogProduct"
  ADD COLUMN "series" "CatalogProductSeries" NOT NULL DEFAULT 'STANDARD';

ALTER TABLE "Node"
  ADD COLUMN "exclusiveAccessProfileId" TEXT;

ALTER TABLE "ManualOrder"
  ADD COLUMN "quotaCadenceSnapshot" "QuotaCadence",
  ADD COLUMN "resetAnchorAtSnapshot" TIMESTAMP(3),
  ADD COLUMN "upgradeFromProductIdSnapshot" TEXT,
  ADD COLUMN "upgradeFromPriceCentsSnapshot" INTEGER,
  ADD COLUMN "entitlementGrantId" TEXT;

ALTER TABLE "EntitlementGrant"
  ADD COLUMN "quotaCadenceSnapshot" "QuotaCadence",
  ADD COLUMN "resetAnchorAt" TIMESTAMP(3),
  ADD COLUMN "priceCentsSnapshot" INTEGER,
  ADD COLUMN "trafficBytesSnapshot" BIGINT,
  ADD COLUMN "activeSlot" TEXT;

UPDATE "ManualOrder" AS orders
SET "quotaCadenceSnapshot" = products."quotaCadence"
FROM "CatalogOffer" AS offers
INNER JOIN "CatalogProduct" AS products ON products.id = offers."productId"
WHERE orders."catalogOfferId" = offers.id
  AND orders."quotaCadenceSnapshot" IS NULL;

UPDATE "EntitlementGrant" AS grants
SET
  "quotaCadenceSnapshot" = products."quotaCadence",
  "resetAnchorAt" = CASE
    WHEN products."quotaCadence" = 'MONTHLY_RESET' THEN grants."startsAt"
    ELSE NULL
  END,
  "priceCentsSnapshot" = offers."priceCents",
  "trafficBytesSnapshot" = offers."trafficBytes"
FROM "CatalogProduct" AS products
INNER JOIN "CatalogOffer" AS offers ON offers."productId" = products.id
WHERE grants."productId" = products.id
  AND offers.id = grants."offerId";

CREATE INDEX "CatalogProduct_series_status_sortOrder_idx"
  ON "CatalogProduct"("series", "status", "sortOrder");
CREATE INDEX "Node_exclusiveAccessProfileId_retiredAt_idx"
  ON "Node"("exclusiveAccessProfileId", "retiredAt");
CREATE INDEX "ManualOrder_entitlementGrantId_createdAt_idx"
  ON "ManualOrder"("entitlementGrantId", "createdAt");
CREATE UNIQUE INDEX "EntitlementGrant_userId_activeSlot_key"
  ON "EntitlementGrant"("userId", "activeSlot");

ALTER TABLE "Node"
  ADD CONSTRAINT "Node_exclusiveAccessProfileId_fkey"
  FOREIGN KEY ("exclusiveAccessProfileId") REFERENCES "AccessProfile"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ManualOrder"
  ADD CONSTRAINT "ManualOrder_entitlementGrantId_fkey"
  FOREIGN KEY ("entitlementGrantId") REFERENCES "EntitlementGrant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "AccessProfile" (
  id, slug, name, description, active,
  "speedUpMbps", "speedDownMbps", "deviceLimit", "createdAt", "updatedAt"
) VALUES (
  'catalog-ultra-shared',
  'catalog-ultra-shared',
  '普通线路 Ultra 专属节点',
  '三个永久 Ultra 档位共用的专属节点组',
  TRUE, 300, 300, 1000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO "CatalogProduct" (
  id, slug, kind, series, status, name, description, "storeUrl",
  "quotaCadence", "accessProfileId", "speedUpMbps", "speedDownMbps",
  "defaultTrafficMultiplierBasisPoints", accent, "sortOrder", featured,
  "purchaseLimitPerUser", "purchaseLimitKey", "requiresActivePlan",
  "referralEligible", "systemManaged", "createdAt", "updatedAt"
) VALUES
  (
    'catalog-ultra-120', 'ultra-120', 'TRAFFIC_PACK', 'ULTRA', 'DRAFT',
    '普通线路 Ultra 120', '一次购买，永久有效，每月 120 GiB 专属节点流量。', NULL,
    'MONTHLY_RESET', 'catalog-ultra-shared', 300, 300, 10000, 'green', 1000, FALSE,
    NULL, 'ultra-series', FALSE, FALSE, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'catalog-ultra-360', 'ultra-360', 'TRAFFIC_PACK', 'ULTRA', 'DRAFT',
    '普通线路 Ultra 360', '一次购买，永久有效，每月 360 GiB 专属节点流量。', NULL,
    'MONTHLY_RESET', 'catalog-ultra-shared', 300, 300, 10000, 'green', 1010, FALSE,
    NULL, 'ultra-series', FALSE, FALSE, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'catalog-ultra-600', 'ultra-600', 'TRAFFIC_PACK', 'ULTRA', 'DRAFT',
    '普通线路 Ultra 600', '一次购买，永久有效，每月 600 GiB 专属节点流量。', NULL,
    'MONTHLY_RESET', 'catalog-ultra-shared', 300, 300, 10000, 'green', 1020, FALSE,
    NULL, 'ultra-series', FALSE, FALSE, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT (slug) DO NOTHING;

INSERT INTO "CatalogOffer" (
  id, "productId", slug, name, "billingPeriod", "intervalMonths",
  "trafficBytes", "priceCents", "storeUrl", currency, active, "isDefault",
  "archivedAt", "createdAt", "updatedAt"
) VALUES
  (
    'catalog-ultra-120-once', 'catalog-ultra-120', 'ultra-120-once', '永久版',
    'ONE_TIME', NULL, 128849018880, 6900, NULL, 'CNY', TRUE, TRUE,
    NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'catalog-ultra-360-once', 'catalog-ultra-360', 'ultra-360-once', '永久版',
    'ONE_TIME', NULL, 386547056640, 12900, NULL, 'CNY', TRUE, TRUE,
    NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'catalog-ultra-600-once', 'catalog-ultra-600', 'ultra-600-once', '永久版',
    'ONE_TIME', NULL, 644245094400, 26000, NULL, 'CNY', TRUE, TRUE,
    NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT (slug) DO NOTHING;
