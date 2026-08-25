CREATE INDEX CONCURRENTLY IF NOT EXISTS "RedemptionCode_kind_status_createdAt_id_idx"
  ON "RedemptionCode"("kind", "status", "createdAt", "id");
