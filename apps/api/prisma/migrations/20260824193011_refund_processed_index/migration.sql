CREATE INDEX CONCURRENTLY IF NOT EXISTS "Refund_status_processedAt_id_idx"
  ON "Refund"("status", "processedAt", "id");
