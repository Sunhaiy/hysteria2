CREATE INDEX CONCURRENTLY IF NOT EXISTS "RedemptionCode_catalogOfferId_status_createdAt_idx"
  ON "RedemptionCode"("catalogOfferId", "status", "createdAt");
