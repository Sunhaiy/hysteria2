CREATE TYPE "CatalogProductKind" AS ENUM ('PLAN', 'TRAFFIC_PACK');
CREATE TYPE "CatalogProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "QuotaCadence" AS ENUM ('MONTHLY_RESET', 'ONE_TIME');
CREATE TYPE "EntitlementGrantKind" AS ENUM ('PLAN', 'TRAFFIC_PACK');
CREATE TYPE "EntitlementGrantStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELED');
CREATE TYPE "QuotaBucketKind" AS ENUM ('PLAN_CYCLE', 'TRAFFIC_PACK');
CREATE TYPE "NodeLifecycleStatus" AS ENUM ('ACTIVE', 'DRAINING', 'MAINTENANCE', 'DISABLED');
CREATE TYPE "PaymentRecordSource" AS ENUM ('WALLET', 'CDK', 'MANUAL');
CREATE TYPE "PaymentRecordStatus" AS ENUM ('PENDING', 'SETTLED', 'VOID');
CREATE TYPE "RefundMethod" AS ENUM ('WALLET', 'MANUAL');
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'APPLIED', 'VOID');
CREATE TYPE "MonitorAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE "MonitorAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

ALTER TABLE "Node"
  ADD COLUMN "lifecycleStatus" "NodeLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "region" TEXT,
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "capacityUsers" INTEGER;
ALTER TABLE "ManualOrder" ADD COLUMN "catalogOfferId" TEXT;

UPDATE "Node" SET "lifecycleStatus" = 'DISABLED' WHERE "active" = false;

CREATE TABLE "CatalogProduct" (
  "id" TEXT NOT NULL,
  "legacyPlanId" TEXT,
  "legacyTrafficPackProductId" TEXT,
  "slug" TEXT NOT NULL,
  "kind" "CatalogProductKind" NOT NULL,
  "status" "CatalogProductStatus" NOT NULL DEFAULT 'DRAFT',
  "name" TEXT NOT NULL,
  "description" TEXT,
  "quotaCadence" "QuotaCadence" NOT NULL,
  "accessProfileId" TEXT,
  "accent" TEXT NOT NULL DEFAULT 'green',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogOffer" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "legacyPlanOfferId" TEXT,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "billingPeriod" "BillingPeriod" NOT NULL,
  "intervalMonths" INTEGER,
  "trafficBytes" BIGINT NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogOffer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntitlementGrant" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accessAccountId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "offerId" TEXT,
  "legacySubscriptionId" TEXT,
  "legacyTrafficPackId" TEXT,
  "kind" "EntitlementGrantKind" NOT NULL,
  "status" "EntitlementGrantStatus" NOT NULL DEFAULT 'ACTIVE',
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "accessProfileId" TEXT NOT NULL,
  "speedUpMbpsSnapshot" INTEGER NOT NULL,
  "speedDownMbpsSnapshot" INTEGER NOT NULL,
  "deviceLimitSnapshot" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EntitlementGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuotaBucket" (
  "id" TEXT NOT NULL,
  "grantId" TEXT NOT NULL,
  "kind" "QuotaBucketKind" NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "grantedBytes" BIGINT NOT NULL,
  "consumedBytes" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuotaBucket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UsageAllocation" (
  "id" TEXT NOT NULL,
  "usageRollupId" TEXT NOT NULL,
  "quotaBucketId" TEXT NOT NULL,
  "accountedBytes" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NodePool" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "region" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NodePool_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NodePoolMember" (
  "id" TEXT NOT NULL,
  "poolId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "weight" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NodePoolMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccessProfilePool" (
  "id" TEXT NOT NULL,
  "accessProfileId" TEXT NOT NULL,
  "poolId" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccessProfilePool_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentRecord" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "source" "PaymentRecordSource" NOT NULL,
  "status" "PaymentRecordStatus" NOT NULL DEFAULT 'SETTLED',
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "externalRef" TEXT,
  "paidAt" TIMESTAMP(3),
  "reconciledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WalletLedgerEntry" (
  "id" TEXT NOT NULL,
  "legacyTransactionId" TEXT,
  "userId" TEXT NOT NULL,
  "actorId" TEXT,
  "orderId" TEXT,
  "amountCents" INTEGER NOT NULL,
  "beforeBalanceCents" INTEGER,
  "afterBalanceCents" INTEGER,
  "kind" "WalletTxnKind" NOT NULL,
  "idempotencyKey" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Refund" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "processedById" TEXT,
  "method" "RefundMethod" NOT NULL,
  "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
  "amountCents" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NodeCost" (
  "id" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "providerReference" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NodeCost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NodeServiceCheck" (
  "id" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "healthy" BOOLEAN NOT NULL,
  "latencyMs" INTEGER,
  "onlineUsers" INTEGER NOT NULL DEFAULT 0,
  "syncDelaySeconds" INTEGER,
  "error" TEXT,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NodeServiceCheck_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MonitorAlert" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "severity" "MonitorAlertSeverity" NOT NULL,
  "status" "MonitorAlertStatus" NOT NULL DEFAULT 'OPEN',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "nodeId" TEXT,
  "acknowledgedById" TEXT,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "successCount" INTEGER NOT NULL DEFAULT 0,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "metadata" JSONB,
  CONSTRAINT "MonitorAlert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MonitorAlertEvent" (
  "id" TEXT NOT NULL,
  "alertId" TEXT NOT NULL,
  "status" "MonitorAlertStatus" NOT NULL,
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonitorAlertEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogProduct_legacyPlanId_key" ON "CatalogProduct"("legacyPlanId");
CREATE UNIQUE INDEX "CatalogProduct_legacyTrafficPackProductId_key" ON "CatalogProduct"("legacyTrafficPackProductId");
CREATE UNIQUE INDEX "CatalogProduct_slug_key" ON "CatalogProduct"("slug");
CREATE INDEX "CatalogProduct_kind_status_sortOrder_idx" ON "CatalogProduct"("kind", "status", "sortOrder");
CREATE INDEX "CatalogProduct_accessProfileId_status_idx" ON "CatalogProduct"("accessProfileId", "status");
CREATE UNIQUE INDEX "CatalogOffer_legacyPlanOfferId_key" ON "CatalogOffer"("legacyPlanOfferId");
CREATE UNIQUE INDEX "CatalogOffer_slug_key" ON "CatalogOffer"("slug");
CREATE UNIQUE INDEX "CatalogOffer_productId_billingPeriod_key" ON "CatalogOffer"("productId", "billingPeriod");
CREATE INDEX "CatalogOffer_productId_active_archivedAt_idx" ON "CatalogOffer"("productId", "active", "archivedAt");
CREATE UNIQUE INDEX "EntitlementGrant_legacySubscriptionId_key" ON "EntitlementGrant"("legacySubscriptionId");
CREATE UNIQUE INDEX "EntitlementGrant_legacyTrafficPackId_key" ON "EntitlementGrant"("legacyTrafficPackId");
CREATE INDEX "EntitlementGrant_userId_kind_status_endsAt_idx" ON "EntitlementGrant"("userId", "kind", "status", "endsAt");
CREATE INDEX "EntitlementGrant_accessAccountId_status_endsAt_idx" ON "EntitlementGrant"("accessAccountId", "status", "endsAt");
CREATE INDEX "EntitlementGrant_accessProfileId_status_idx" ON "EntitlementGrant"("accessProfileId", "status");
CREATE UNIQUE INDEX "QuotaBucket_grantId_startsAt_key" ON "QuotaBucket"("grantId", "startsAt");
CREATE INDEX "QuotaBucket_endsAt_grantId_idx" ON "QuotaBucket"("endsAt", "grantId");
CREATE UNIQUE INDEX "UsageAllocation_usageRollupId_quotaBucketId_key" ON "UsageAllocation"("usageRollupId", "quotaBucketId");
CREATE INDEX "UsageAllocation_quotaBucketId_createdAt_idx" ON "UsageAllocation"("quotaBucketId", "createdAt");
CREATE UNIQUE INDEX "NodePool_slug_key" ON "NodePool"("slug");
CREATE UNIQUE INDEX "NodePoolMember_poolId_nodeId_key" ON "NodePoolMember"("poolId", "nodeId");
CREATE INDEX "NodePoolMember_nodeId_priority_idx" ON "NodePoolMember"("nodeId", "priority");
CREATE UNIQUE INDEX "AccessProfilePool_accessProfileId_poolId_key" ON "AccessProfilePool"("accessProfileId", "poolId");
CREATE INDEX "AccessProfilePool_poolId_priority_idx" ON "AccessProfilePool"("poolId", "priority");
CREATE INDEX "PaymentRecord_status_paidAt_idx" ON "PaymentRecord"("status", "paidAt");
CREATE INDEX "PaymentRecord_userId_createdAt_idx" ON "PaymentRecord"("userId", "createdAt");
CREATE UNIQUE INDEX "WalletLedgerEntry_legacyTransactionId_key" ON "WalletLedgerEntry"("legacyTransactionId");
CREATE UNIQUE INDEX "WalletLedgerEntry_userId_idempotencyKey_key" ON "WalletLedgerEntry"("userId", "idempotencyKey");
CREATE INDEX "WalletLedgerEntry_userId_createdAt_idx" ON "WalletLedgerEntry"("userId", "createdAt");
CREATE INDEX "WalletLedgerEntry_orderId_createdAt_idx" ON "WalletLedgerEntry"("orderId", "createdAt");
CREATE INDEX "Refund_status_createdAt_idx" ON "Refund"("status", "createdAt");
CREATE INDEX "Refund_orderId_createdAt_idx" ON "Refund"("orderId", "createdAt");
CREATE INDEX "NodeCost_nodeId_effectiveFrom_effectiveTo_idx" ON "NodeCost"("nodeId", "effectiveFrom", "effectiveTo");
CREATE INDEX "NodeServiceCheck_nodeId_checkedAt_idx" ON "NodeServiceCheck"("nodeId", "checkedAt");
CREATE UNIQUE INDEX "MonitorAlert_fingerprint_key" ON "MonitorAlert"("fingerprint");
CREATE INDEX "MonitorAlert_status_severity_lastSeenAt_idx" ON "MonitorAlert"("status", "severity", "lastSeenAt");
CREATE INDEX "MonitorAlert_nodeId_status_idx" ON "MonitorAlert"("nodeId", "status");
CREATE INDEX "MonitorAlertEvent_alertId_createdAt_idx" ON "MonitorAlertEvent"("alertId", "createdAt");
CREATE INDEX "ManualOrder_catalogOfferId_createdAt_idx" ON "ManualOrder"("catalogOfferId", "createdAt");

ALTER TABLE "CatalogProduct" ADD CONSTRAINT "CatalogProduct_legacyPlanId_fkey" FOREIGN KEY ("legacyPlanId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CatalogProduct" ADD CONSTRAINT "CatalogProduct_legacyTrafficPackProductId_fkey" FOREIGN KEY ("legacyTrafficPackProductId") REFERENCES "TrafficPackProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CatalogProduct" ADD CONSTRAINT "CatalogProduct_accessProfileId_fkey" FOREIGN KEY ("accessProfileId") REFERENCES "AccessProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogOffer" ADD CONSTRAINT "CatalogOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CatalogProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogOffer" ADD CONSTRAINT "CatalogOffer_legacyPlanOfferId_fkey" FOREIGN KEY ("legacyPlanOfferId") REFERENCES "PlanOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EntitlementGrant" ADD CONSTRAINT "EntitlementGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntitlementGrant" ADD CONSTRAINT "EntitlementGrant_accessAccountId_fkey" FOREIGN KEY ("accessAccountId") REFERENCES "AccessAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntitlementGrant" ADD CONSTRAINT "EntitlementGrant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CatalogProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EntitlementGrant" ADD CONSTRAINT "EntitlementGrant_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "CatalogOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EntitlementGrant" ADD CONSTRAINT "EntitlementGrant_accessProfileId_fkey" FOREIGN KEY ("accessProfileId") REFERENCES "AccessProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EntitlementGrant" ADD CONSTRAINT "EntitlementGrant_legacySubscriptionId_fkey" FOREIGN KEY ("legacySubscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EntitlementGrant" ADD CONSTRAINT "EntitlementGrant_legacyTrafficPackId_fkey" FOREIGN KEY ("legacyTrafficPackId") REFERENCES "TrafficPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QuotaBucket" ADD CONSTRAINT "QuotaBucket_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "EntitlementGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageAllocation" ADD CONSTRAINT "UsageAllocation_usageRollupId_fkey" FOREIGN KEY ("usageRollupId") REFERENCES "UsageRollup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageAllocation" ADD CONSTRAINT "UsageAllocation_quotaBucketId_fkey" FOREIGN KEY ("quotaBucketId") REFERENCES "QuotaBucket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NodePoolMember" ADD CONSTRAINT "NodePoolMember_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "NodePool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NodePoolMember" ADD CONSTRAINT "NodePoolMember_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessProfilePool" ADD CONSTRAINT "AccessProfilePool_accessProfileId_fkey" FOREIGN KEY ("accessProfileId") REFERENCES "AccessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessProfilePool" ADD CONSTRAINT "AccessProfilePool_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "NodePool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ManualOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ManualOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ManualOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NodeCost" ADD CONSTRAINT "NodeCost_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NodeServiceCheck" ADD CONSTRAINT "NodeServiceCheck_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonitorAlert" ADD CONSTRAINT "MonitorAlert_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MonitorAlert" ADD CONSTRAINT "MonitorAlert_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MonitorAlertEvent" ADD CONSTRAINT "MonitorAlertEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "MonitorAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManualOrder" ADD CONSTRAINT "ManualOrder_catalogOfferId_fkey" FOREIGN KEY ("catalogOfferId") REFERENCES "CatalogOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "CatalogProduct" (
  "id", "legacyPlanId", "slug", "kind", "status", "name", "description",
  "quotaCadence", "accessProfileId", "accent", "createdAt", "updatedAt"
)
SELECT
  'catalog_plan_' || substr(md5(p."id"), 1, 18), p."id", 'plan-' || p."slug",
  'PLAN', CASE WHEN p."active" THEN 'ACTIVE'::"CatalogProductStatus" ELSE 'DRAFT'::"CatalogProductStatus" END,
  p."name", p."description", 'MONTHLY_RESET', p."accessProfileId", p."accent", p."createdAt", CURRENT_TIMESTAMP
FROM "Plan" p;

INSERT INTO "CatalogProduct" (
  "id", "legacyTrafficPackProductId", "slug", "kind", "status", "name", "description",
  "quotaCadence", "accessProfileId", "accent", "createdAt", "updatedAt"
)
SELECT
  'catalog_pack_' || substr(md5(tp."id"), 1, 18), tp."id", 'pack-' || tp."slug",
  'TRAFFIC_PACK',
  CASE WHEN tp."active" AND tp."archivedAt" IS NULL THEN 'ACTIVE'::"CatalogProductStatus" ELSE 'ARCHIVED'::"CatalogProductStatus" END,
  tp."name", tp."description", 'ONE_TIME', tp."accessProfileId", tp."accent", tp."createdAt", CURRENT_TIMESTAMP
FROM "TrafficPackProduct" tp;

INSERT INTO "CatalogOffer" (
  "id", "productId", "legacyPlanOfferId", "slug", "name", "billingPeriod", "intervalMonths",
  "trafficBytes", "priceCents", "active", "isDefault", "archivedAt", "createdAt", "updatedAt"
)
SELECT
  'catalog_offer_' || substr(md5(po."id"), 1, 18), cp."id", po."id", 'offer-' || po."slug", po."name",
  po."billingPeriod", po."intervalMonths", p."trafficBytes", po."priceCents", po."active", po."isDefault",
  po."archivedAt", po."createdAt", CURRENT_TIMESTAMP
FROM "PlanOffer" po
JOIN "Plan" p ON p."id" = po."planId"
JOIN "CatalogProduct" cp ON cp."legacyPlanId" = p."id";

INSERT INTO "CatalogOffer" (
  "id", "productId", "slug", "name", "billingPeriod", "intervalMonths", "trafficBytes",
  "priceCents", "active", "isDefault", "archivedAt", "createdAt", "updatedAt"
)
SELECT
  'catalog_offer_pack_' || substr(md5(tp."id"), 1, 13), cp."id", 'offer-pack-' || tp."slug" || '-legacy',
  '原有规格', 'LEGACY', NULL, tp."trafficBytes", tp."priceCents", false, true,
  COALESCE(tp."archivedAt", CURRENT_TIMESTAMP), tp."createdAt", CURRENT_TIMESTAMP
FROM "TrafficPackProduct" tp
JOIN "CatalogProduct" cp ON cp."legacyTrafficPackProductId" = tp."id";

UPDATE "ManualOrder" mo
SET "catalogOfferId" = co."id"
FROM "CatalogOffer" co
WHERE co."legacyPlanOfferId" = mo."planOfferId";

INSERT INTO "NodePool" ("id", "slug", "name", "description", "active", "createdAt", "updatedAt")
SELECT
  'pool_' || substr(md5(ap."id"), 1, 20), 'pool-' || ap."slug", ap."name" || ' 节点池',
  '由现有访问策略无损迁移', ap."active", ap."createdAt", CURRENT_TIMESTAMP
FROM "AccessProfile" ap;

INSERT INTO "NodePoolMember" ("id", "poolId", "nodeId", "priority", "weight", "createdAt")
SELECT
  'pool_member_' || substr(md5(apn."id"), 1, 16), np."id", apn."nodeId", apn."priority", 100, apn."createdAt"
FROM "AccessProfileNode" apn
JOIN "NodePool" np ON np."id" = 'pool_' || substr(md5(apn."accessProfileId"), 1, 20);

INSERT INTO "AccessProfilePool" ("id", "accessProfileId", "poolId", "priority", "createdAt")
SELECT
  'profile_pool_' || substr(md5(ap."id"), 1, 16), ap."id", np."id", 0, CURRENT_TIMESTAMP
FROM "AccessProfile" ap
JOIN "NodePool" np ON np."id" = 'pool_' || substr(md5(ap."id"), 1, 20);

INSERT INTO "EntitlementGrant" (
  "id", "userId", "accessAccountId", "productId", "offerId", "legacySubscriptionId", "kind", "status",
  "startsAt", "endsAt", "accessProfileId", "speedUpMbpsSnapshot", "speedDownMbpsSnapshot",
  "deviceLimitSnapshot", "createdAt", "updatedAt"
)
SELECT
  'grant_sub_' || substr(md5(s."id"), 1, 20), s."userId", s."accessAccountId", cp."id", co."id", s."id", 'PLAN',
  CASE s."status" WHEN 'ACTIVE' THEN 'ACTIVE'::"EntitlementGrantStatus" WHEN 'CANCELED' THEN 'CANCELED'::"EntitlementGrantStatus" ELSE 'EXPIRED'::"EntitlementGrantStatus" END,
  s."startsAt", s."endsAt", p."accessProfileId", s."speedUpMbpsSnapshot", s."speedDownMbpsSnapshot",
  s."deviceLimitSnapshot", s."createdAt", CURRENT_TIMESTAMP
FROM "Subscription" s
JOIN "Plan" p ON p."id" = s."planId"
JOIN "CatalogProduct" cp ON cp."legacyPlanId" = p."id"
LEFT JOIN "CatalogOffer" co ON co."legacyPlanOfferId" = s."planOfferId"
WHERE s."accessAccountId" IS NOT NULL AND p."accessProfileId" IS NOT NULL;

INSERT INTO "QuotaBucket" (
  "id", "grantId", "kind", "startsAt", "endsAt", "grantedBytes", "consumedBytes", "createdAt", "updatedAt"
)
SELECT
  'bucket_cycle_' || substr(md5(sc."id"), 1, 18), eg."id", 'PLAN_CYCLE', sc."startsAt", sc."endsAt",
  sc."grantedBytes" + sc."adjustmentBytes", sc."consumedBytes", sc."createdAt", CURRENT_TIMESTAMP
FROM "SubscriptionCycle" sc
JOIN "EntitlementGrant" eg ON eg."legacySubscriptionId" = sc."subscriptionId";

INSERT INTO "EntitlementGrant" (
  "id", "userId", "accessAccountId", "productId", "offerId", "legacyTrafficPackId", "kind", "status",
  "startsAt", "endsAt", "accessProfileId", "speedUpMbpsSnapshot", "speedDownMbpsSnapshot",
  "deviceLimitSnapshot", "createdAt", "updatedAt"
)
SELECT
  'grant_pack_' || substr(md5(tp."id"), 1, 19), tp."userId", tp."accessAccountId", cp."id", co."id", tp."id", 'TRAFFIC_PACK',
  CASE tp."status" WHEN 'ACTIVE' THEN 'ACTIVE'::"EntitlementGrantStatus" ELSE 'EXPIRED'::"EntitlementGrantStatus" END,
  tp."createdAt", COALESCE(tp."expiresAt", tp."createdAt" + INTERVAL '100 years'), tp."accessProfileId",
  ap."speedUpMbps", ap."speedDownMbps", ap."deviceLimit", tp."createdAt", CURRENT_TIMESTAMP
FROM "TrafficPack" tp
JOIN "CatalogProduct" cp ON cp."legacyTrafficPackProductId" = tp."trafficPackProductId"
JOIN "CatalogOffer" co ON co."productId" = cp."id" AND co."billingPeriod" = 'LEGACY'
JOIN "AccessProfile" ap ON ap."id" = tp."accessProfileId"
WHERE tp."accessAccountId" IS NOT NULL AND tp."accessProfileId" IS NOT NULL;

INSERT INTO "QuotaBucket" (
  "id", "grantId", "kind", "startsAt", "endsAt", "grantedBytes", "consumedBytes", "createdAt", "updatedAt"
)
SELECT
  'bucket_pack_' || substr(md5(tp."id"), 1, 19), eg."id", 'TRAFFIC_PACK', tp."createdAt",
  COALESCE(tp."expiresAt", tp."createdAt" + INTERVAL '100 years'), tp."totalBytes",
  GREATEST(tp."totalBytes" - tp."remainingBytes", 0), tp."createdAt", CURRENT_TIMESTAMP
FROM "TrafficPack" tp
JOIN "EntitlementGrant" eg ON eg."legacyTrafficPackId" = tp."id";

INSERT INTO "PaymentRecord" (
  "id", "orderId", "userId", "source", "status", "amountCents", "currency", "paidAt", "createdAt"
)
SELECT
  'payment_' || substr(md5(mo."id"), 1, 20), mo."id", mo."userId",
  CASE mo."source" WHEN 'WALLET' THEN 'WALLET'::"PaymentRecordSource" WHEN 'CDK' THEN 'CDK'::"PaymentRecordSource" ELSE 'MANUAL'::"PaymentRecordSource" END,
  CASE mo."status" WHEN 'APPLIED' THEN 'SETTLED'::"PaymentRecordStatus" WHEN 'VOID' THEN 'VOID'::"PaymentRecordStatus" ELSE 'PENDING'::"PaymentRecordStatus" END,
  mo."amountCents", mo."currency", mo."processedAt", mo."createdAt"
FROM "ManualOrder" mo;

INSERT INTO "WalletLedgerEntry" (
  "id", "legacyTransactionId", "userId", "amountCents", "kind", "note", "createdAt"
)
SELECT
  'ledger_' || substr(md5(wt."id"), 1, 21), wt."id", wt."userId", wt."amountCents", wt."kind", wt."note", wt."createdAt"
FROM "WalletTransaction" wt;
