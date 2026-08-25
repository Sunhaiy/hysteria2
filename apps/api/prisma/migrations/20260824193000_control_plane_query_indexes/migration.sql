-- Build indexes without blocking normal writes on the high-volume tables.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_role_status_createdAt_id_idx"
  ON "User"("role", "status", "createdAt", "id");
