ALTER TABLE "EpayPaymentAttempt"
  ADD COLUMN IF NOT EXISTS "gatewayUrlSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "merchantIdSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "merchantKeyCiphertext" TEXT,
  ADD COLUMN IF NOT EXISTS "entitlementSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "settlementFailureCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastSettlementError" TEXT,
  ADD COLUMN IF NOT EXISTS "lastSettlementFailedAt" TIMESTAMP(3);

ALTER TABLE "ManualOrder"
  ADD COLUMN IF NOT EXISTS "speedUpMbpsSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "speedDownMbpsSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "deviceLimitSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "trafficMultiplierBasisPointsSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "requiresActivePlanSnapshot" BOOLEAN;
