-- Security: passwords must never be recoverable and session changes must be revocable.
ALTER TABLE "User" DROP COLUMN IF EXISTS "plainPassword";
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 1;

CREATE TYPE "OrderSource" AS ENUM ('LEGACY', 'ADMIN', 'WALLET', 'CDK', 'PAYMENT');
CREATE TYPE "UsageImportBatchStatus" AS ENUM ('APPLIED', 'ACKED');

ALTER TABLE "TrafficPackProduct" ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "ManualOrder"
  ADD COLUMN "trafficPackProductId" TEXT,
  ADD COLUMN "source" "OrderSource" NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "basePriceCents" INTEGER,
  ADD COLUMN "discountCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'CNY',
  ADD COLUMN "productSlugSnapshot" TEXT,
  ADD COLUMN "productNameSnapshot" TEXT,
  ADD COLUMN "validityDays" INTEGER,
  ADD COLUMN "entitlementExpiresAt" TIMESTAMP(3),
  ADD COLUMN "idempotencyKey" TEXT;

ALTER TABLE "RedemptionCode" ADD COLUMN "trafficPackProductId" TEXT;

CREATE UNIQUE INDEX "ManualOrder_userId_idempotencyKey_key"
  ON "ManualOrder"("userId", "idempotencyKey");
CREATE INDEX "ManualOrder_trafficPackProductId_createdAt_idx"
  ON "ManualOrder"("trafficPackProductId", "createdAt");

ALTER TABLE "ManualOrder" ADD CONSTRAINT "ManualOrder_trafficPackProductId_fkey"
  FOREIGN KEY ("trafficPackProductId") REFERENCES "TrafficPackProduct"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RedemptionCode" ADD CONSTRAINT "RedemptionCode_trafficPackProductId_fkey"
  FOREIGN KEY ("trafficPackProductId") REFERENCES "TrafficPackProduct"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "UsageImportBatch" (
  "id" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "status" "UsageImportBatchStatus" NOT NULL DEFAULT 'APPLIED',
  "claimedAt" TIMESTAMP(3) NOT NULL,
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ackedAt" TIMESTAMP(3),
  "totalTxBytes" BIGINT NOT NULL,
  "totalRxBytes" BIGINT NOT NULL,
  "recordCount" INTEGER NOT NULL,
  CONSTRAINT "UsageImportBatch_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "UsageRollup" ADD COLUMN "importBatchId" TEXT;
CREATE UNIQUE INDEX "UsageImportBatch_nodeId_externalId_key"
  ON "UsageImportBatch"("nodeId", "externalId");
CREATE INDEX "UsageImportBatch_status_appliedAt_idx"
  ON "UsageImportBatch"("status", "appliedAt");
CREATE UNIQUE INDEX "UsageRollup_importBatchId_userId_key"
  ON "UsageRollup"("importBatchId", "userId");
ALTER TABLE "UsageImportBatch" ADD CONSTRAINT "UsageImportBatch_nodeId_fkey"
  FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageRollup" ADD CONSTRAINT "UsageRollup_importBatchId_fkey"
  FOREIGN KEY ("importBatchId") REFERENCES "UsageImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PasswordResetToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdById" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "metadata" JSONB,
  "remoteAddr" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX "AuditLog_targetType_targetId_createdAt_idx" ON "AuditLog"("targetType", "targetId", "createdAt");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
