CREATE INDEX CONCURRENTLY IF NOT EXISTS "UsageRollup_bucketStart_id_idx"
  ON "UsageRollup"("bucketStart", "id");
