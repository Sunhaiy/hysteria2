CREATE INDEX CONCURRENTLY IF NOT EXISTS "ManualOrder_userId_createdAt_id_idx"
  ON "ManualOrder"("userId", "createdAt", "id");
