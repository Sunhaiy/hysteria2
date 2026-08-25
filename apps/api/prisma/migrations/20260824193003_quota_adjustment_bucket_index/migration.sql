CREATE INDEX CONCURRENTLY IF NOT EXISTS "QuotaAdjustment_quotaBucketId_createdAt_idx"
  ON "QuotaAdjustment"("quotaBucketId", "createdAt");
