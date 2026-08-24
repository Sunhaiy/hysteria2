CREATE TYPE "BillingPeriod" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY', 'LEGACY');
CREATE TYPE "QuotaAdjustmentMode" AS ENUM ('DELTA', 'SET_REMAINING');
CREATE TYPE "DestinationTransport" AS ENUM ('TCP', 'UDP');
CREATE TYPE "DestinationTargetType" AS ENUM ('DOMAIN', 'IP');
CREATE TYPE "AdminPermission" AS ENUM ('DESTINATION_AUDIT_READ', 'ADMIN_PERMISSIONS_MANAGE');

CREATE TABLE "AccessAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "trafficMultiplierBasisPoints" INTEGER NOT NULL DEFAULT 10000,
  "trafficMultiplierRemainder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccessAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminPermissionGrant" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "permission" "AdminPermission" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminPermissionGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccessProfile" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "speedUpMbps" INTEGER NOT NULL,
  "speedDownMbps" INTEGER NOT NULL,
  "deviceLimit" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccessProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccessProfileNode" (
  "id" TEXT NOT NULL,
  "accessProfileId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccessProfileNode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlanOffer" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "billingPeriod" "BillingPeriod" NOT NULL,
  "intervalMonths" INTEGER,
  "legacyDurationDays" INTEGER,
  "priceCents" INTEGER NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlanOffer_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TrafficPackProduct" ADD COLUMN "accessProfileId" TEXT;
ALTER TABLE "Plan" ADD COLUMN "accessProfileId" TEXT;
ALTER TABLE "Node"
  ADD COLUMN "destinationTelemetryEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "destinationTelemetryVersion" TEXT,
  ADD COLUMN "destinationTelemetryLastAt" TIMESTAMP(3),
  ADD COLUMN "destinationTelemetryError" TEXT;
ALTER TABLE "Subscription"
  ADD COLUMN "accessAccountId" TEXT,
  ADD COLUMN "planOfferId" TEXT;
ALTER TABLE "TrafficPack"
  ADD COLUMN "accessAccountId" TEXT,
  ADD COLUMN "trafficPackProductId" TEXT,
  ADD COLUMN "accessProfileId" TEXT;
ALTER TABLE "ManualOrder"
  ADD COLUMN "planOfferId" TEXT,
  ADD COLUMN "billingPeriodSnapshot" "BillingPeriod",
  ADD COLUMN "intervalMonthsSnapshot" INTEGER,
  ADD COLUMN "accessProfileIdSnapshot" TEXT;
ALTER TABLE "UsageRollup"
  ADD COLUMN "subscriptionCycleId" TEXT,
  ADD COLUMN "accountedBytes" BIGINT,
  ADD COLUMN "overageBytes" BIGINT NOT NULL DEFAULT 0;

CREATE TABLE "SubscriptionCycle" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "grantedBytes" BIGINT NOT NULL,
  "adjustmentBytes" BIGINT NOT NULL DEFAULT 0,
  "consumedBytes" BIGINT NOT NULL DEFAULT 0,
  "overageBytes" BIGINT NOT NULL DEFAULT 0,
  "legacy" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubscriptionCycle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuotaAdjustment" (
  "id" TEXT NOT NULL,
  "accessAccountId" TEXT NOT NULL,
  "subscriptionCycleId" TEXT,
  "trafficPackId" TEXT,
  "actorId" TEXT,
  "mode" "QuotaAdjustmentMode" NOT NULL,
  "deltaBytes" BIGINT NOT NULL,
  "beforeRemainingBytes" BIGINT NOT NULL,
  "afterRemainingBytes" BIGINT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuotaAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DestinationImportBatch" (
  "id" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "eventCount" INTEGER NOT NULL,
  CONSTRAINT "DestinationImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DestinationVisitRollup" (
  "id" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "bucketStart" TIMESTAMP(3) NOT NULL,
  "target" TEXT NOT NULL,
  "targetType" "DestinationTargetType" NOT NULL,
  "port" INTEGER NOT NULL,
  "transport" "DestinationTransport" NOT NULL,
  "connectionCount" INTEGER NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DestinationVisitRollup_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AccessAccount" ("id", "userId", "trafficMultiplierBasisPoints", "trafficMultiplierRemainder", "createdAt", "updatedAt")
SELECT 'acct_' || substr(md5("id"), 1, 24), "id", 10000, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User";

INSERT INTO "AccessProfile" ("id", "slug", "name", "description", "active", "speedUpMbps", "speedDownMbps", "deviceLimit", "createdAt", "updatedAt")
SELECT 'profile_' || substr(md5("id"), 1, 20), "slug", "name", "description", "active", "speedUpMbps", "speedDownMbps", "deviceLimit", "createdAt", CURRENT_TIMESTAMP
FROM "Plan";

UPDATE "Plan" p
SET "accessProfileId" = 'profile_' || substr(md5(p."id"), 1, 20);

INSERT INTO "AccessProfileNode" ("id", "accessProfileId", "nodeId", "priority", "createdAt")
SELECT 'apn_' || substr(md5(pb."id"), 1, 24), p."accessProfileId", pb."nodeId", pb."priority", pb."createdAt"
FROM "PlanBinding" pb
JOIN "Plan" p ON p."id" = pb."planId";

INSERT INTO "PlanOffer" ("id", "planId", "slug", "name", "active", "isDefault", "billingPeriod", "legacyDurationDays", "priceCents", "createdAt", "updatedAt")
SELECT 'offer_' || substr(md5("id"), 1, 22), "id", "slug" || '-legacy', "name" || ' 原销售规格', "active", true, 'LEGACY', "durationDays", "priceCents", "createdAt", CURRENT_TIMESTAMP
FROM "Plan";

UPDATE "Subscription" s
SET "accessAccountId" = a."id",
    "planOfferId" = 'offer_' || substr(md5(s."planId"), 1, 22)
FROM "AccessAccount" a
WHERE a."userId" = s."userId";

INSERT INTO "SubscriptionCycle" ("id", "subscriptionId", "startsAt", "endsAt", "grantedBytes", "adjustmentBytes", "consumedBytes", "overageBytes", "legacy", "createdAt", "updatedAt")
SELECT 'cycle_' || substr(md5("id"), 1, 22), "id", "startsAt", "endsAt",
       "includedTrafficBytes" + "bonusTrafficBytes", 0, "consumedTrafficBytes", 0, true, "createdAt", CURRENT_TIMESTAMP
FROM "Subscription";

UPDATE "TrafficPack" tp
SET "accessAccountId" = a."id",
    "accessProfileId" = p."accessProfileId",
    "expiresAt" = COALESCE(tp."expiresAt", s."endsAt")
FROM "AccessAccount" a, "Subscription" s, "Plan" p
WHERE a."userId" = tp."userId"
  AND s."id" = tp."subscriptionId"
  AND p."id" = s."planId";

INSERT INTO "AdminPermissionGrant" ("id", "userId", "permission", "createdAt")
SELECT 'perm_' || substr(md5("id" || ':destination'), 1, 22), "id", 'DESTINATION_AUDIT_READ', CURRENT_TIMESTAMP
FROM "User" WHERE "role" = 'ADMIN';
INSERT INTO "AdminPermissionGrant" ("id", "userId", "permission", "createdAt")
SELECT 'perm_' || substr(md5("id" || ':permissions'), 1, 22), "id", 'ADMIN_PERMISSIONS_MANAGE', CURRENT_TIMESTAMP
FROM "User" WHERE "role" = 'ADMIN';

ALTER TABLE "TrafficPack" ALTER COLUMN "subscriptionId" DROP NOT NULL;
ALTER TABLE "TrafficPack" DROP CONSTRAINT IF EXISTS "TrafficPack_subscriptionId_fkey";
ALTER TABLE "TrafficPack" ADD CONSTRAINT "TrafficPack_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UsageRollup" ALTER COLUMN "subscriptionId" DROP NOT NULL;
ALTER TABLE "UsageRollup" DROP CONSTRAINT IF EXISTS "UsageRollup_subscriptionId_fkey";
ALTER TABLE "UsageRollup" ADD CONSTRAINT "UsageRollup_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "AccessAccount_userId_key" ON "AccessAccount"("userId");
CREATE UNIQUE INDEX "AdminPermissionGrant_userId_permission_key" ON "AdminPermissionGrant"("userId", "permission");
CREATE INDEX "AdminPermissionGrant_permission_userId_idx" ON "AdminPermissionGrant"("permission", "userId");
CREATE UNIQUE INDEX "AccessProfile_slug_key" ON "AccessProfile"("slug");
CREATE UNIQUE INDEX "AccessProfileNode_accessProfileId_nodeId_key" ON "AccessProfileNode"("accessProfileId", "nodeId");
CREATE INDEX "AccessProfileNode_nodeId_priority_idx" ON "AccessProfileNode"("nodeId", "priority");
CREATE UNIQUE INDEX "PlanOffer_slug_key" ON "PlanOffer"("slug");
CREATE INDEX "PlanOffer_planId_active_archivedAt_idx" ON "PlanOffer"("planId", "active", "archivedAt");
CREATE UNIQUE INDEX "SubscriptionCycle_subscriptionId_startsAt_key" ON "SubscriptionCycle"("subscriptionId", "startsAt");
CREATE INDEX "SubscriptionCycle_endsAt_subscriptionId_idx" ON "SubscriptionCycle"("endsAt", "subscriptionId");
CREATE INDEX "TrafficPack_accessAccountId_status_expiresAt_idx" ON "TrafficPack"("accessAccountId", "status", "expiresAt");
CREATE INDEX "QuotaAdjustment_accessAccountId_createdAt_idx" ON "QuotaAdjustment"("accessAccountId", "createdAt");
CREATE INDEX "QuotaAdjustment_subscriptionCycleId_createdAt_idx" ON "QuotaAdjustment"("subscriptionCycleId", "createdAt");
CREATE INDEX "QuotaAdjustment_trafficPackId_createdAt_idx" ON "QuotaAdjustment"("trafficPackId", "createdAt");
CREATE INDEX "ManualOrder_planOfferId_createdAt_idx" ON "ManualOrder"("planOfferId", "createdAt");
CREATE UNIQUE INDEX "DestinationImportBatch_nodeId_externalId_key" ON "DestinationImportBatch"("nodeId", "externalId");
CREATE INDEX "DestinationImportBatch_receivedAt_idx" ON "DestinationImportBatch"("receivedAt");
CREATE UNIQUE INDEX "DestinationVisitRollup_dedupeKey_key" ON "DestinationVisitRollup"("dedupeKey");
CREATE INDEX "DestinationVisitRollup_userId_bucketStart_idx" ON "DestinationVisitRollup"("userId", "bucketStart");
CREATE INDEX "DestinationVisitRollup_target_bucketStart_idx" ON "DestinationVisitRollup"("target", "bucketStart");
CREATE INDEX "DestinationVisitRollup_nodeId_bucketStart_idx" ON "DestinationVisitRollup"("nodeId", "bucketStart");

ALTER TABLE "AccessAccount" ADD CONSTRAINT "AccessAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminPermissionGrant" ADD CONSTRAINT "AdminPermissionGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessProfileNode" ADD CONSTRAINT "AccessProfileNode_accessProfileId_fkey" FOREIGN KEY ("accessProfileId") REFERENCES "AccessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessProfileNode" ADD CONSTRAINT "AccessProfileNode_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrafficPackProduct" ADD CONSTRAINT "TrafficPackProduct_accessProfileId_fkey" FOREIGN KEY ("accessProfileId") REFERENCES "AccessProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_accessProfileId_fkey" FOREIGN KEY ("accessProfileId") REFERENCES "AccessProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanOffer" ADD CONSTRAINT "PlanOffer_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_accessAccountId_fkey" FOREIGN KEY ("accessAccountId") REFERENCES "AccessAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planOfferId_fkey" FOREIGN KEY ("planOfferId") REFERENCES "PlanOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionCycle" ADD CONSTRAINT "SubscriptionCycle_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrafficPack" ADD CONSTRAINT "TrafficPack_accessAccountId_fkey" FOREIGN KEY ("accessAccountId") REFERENCES "AccessAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrafficPack" ADD CONSTRAINT "TrafficPack_trafficPackProductId_fkey" FOREIGN KEY ("trafficPackProductId") REFERENCES "TrafficPackProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrafficPack" ADD CONSTRAINT "TrafficPack_accessProfileId_fkey" FOREIGN KEY ("accessProfileId") REFERENCES "AccessProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuotaAdjustment" ADD CONSTRAINT "QuotaAdjustment_accessAccountId_fkey" FOREIGN KEY ("accessAccountId") REFERENCES "AccessAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuotaAdjustment" ADD CONSTRAINT "QuotaAdjustment_subscriptionCycleId_fkey" FOREIGN KEY ("subscriptionCycleId") REFERENCES "SubscriptionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuotaAdjustment" ADD CONSTRAINT "QuotaAdjustment_trafficPackId_fkey" FOREIGN KEY ("trafficPackId") REFERENCES "TrafficPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuotaAdjustment" ADD CONSTRAINT "QuotaAdjustment_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManualOrder" ADD CONSTRAINT "ManualOrder_planOfferId_fkey" FOREIGN KEY ("planOfferId") REFERENCES "PlanOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UsageRollup" ADD CONSTRAINT "UsageRollup_subscriptionCycleId_fkey" FOREIGN KEY ("subscriptionCycleId") REFERENCES "SubscriptionCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DestinationImportBatch" ADD CONSTRAINT "DestinationImportBatch_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DestinationVisitRollup" ADD CONSTRAINT "DestinationVisitRollup_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DestinationImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DestinationVisitRollup" ADD CONSTRAINT "DestinationVisitRollup_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DestinationVisitRollup" ADD CONSTRAINT "DestinationVisitRollup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
