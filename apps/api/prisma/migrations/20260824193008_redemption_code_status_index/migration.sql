CREATE INDEX CONCURRENTLY IF NOT EXISTS "RedemptionCode_status_createdAt_id_idx"
  ON "RedemptionCode"("status", "createdAt", "id");
