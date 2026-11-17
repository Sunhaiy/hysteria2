-- Additive: old API/worker binaries keep reading/writing lastSyncError.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE "Node"
  ADD COLUMN "lastUserSyncError" TEXT,
  ADD COLUMN "lastTrafficSyncError" TEXT;

-- A legacy error has no source discriminator. Preserve it until each relevant
-- sync flow has actually succeeded; never infer recovery from the migration.
UPDATE "Node"
SET "lastTrafficSyncError" = "lastSyncError",
    "lastUserSyncError" = CASE
      WHEN "protocol" = 'VLESS_REALITY' THEN "lastSyncError"
      ELSE NULL
    END
WHERE "lastSyncError" IS NOT NULL;
COMMIT;
