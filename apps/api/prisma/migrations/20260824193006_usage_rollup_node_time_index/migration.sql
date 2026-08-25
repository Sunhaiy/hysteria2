CREATE INDEX CONCURRENTLY IF NOT EXISTS "UsageRollup_nodeId_bucketStart_id_idx"
  ON "UsageRollup"("nodeId", "bucketStart", "id");
