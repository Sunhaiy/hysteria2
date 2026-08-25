CREATE INDEX CONCURRENTLY IF NOT EXISTS "ManualOrder_status_source_processedAt_id_idx"
  ON "ManualOrder"("status", "source", "processedAt", "id");
