ALTER TABLE "EpayPaymentAttempt"
  ADD COLUMN IF NOT EXISTS "lastQueryAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "queryFailureCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastQueryError" TEXT,
  ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);

ALTER TABLE "EpayGatewayTestAttempt"
  ADD COLUMN IF NOT EXISTS "lastQueryAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "queryFailureCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastQueryError" TEXT,
  ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);

CREATE INDEX "EpayPaymentAttempt_status_lastQueryAt_createdAt_id_idx"
  ON "EpayPaymentAttempt"("status", "lastQueryAt", "createdAt", "id");

CREATE INDEX "EpayGatewayTestAttempt_status_lastQueryAt_createdAt_id_idx"
  ON "EpayGatewayTestAttempt"("status", "lastQueryAt", "createdAt", "id");
