CREATE INDEX CONCURRENTLY IF NOT EXISTS "AuditLog_createdAt_id_idx"
  ON "AuditLog"("createdAt", "id");
