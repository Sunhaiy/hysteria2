-- CONTRACT phase only: old API/worker processes must be drained and node
-- updater executors removed before applying this migration. See ADR 0016.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

-- Use the same lock as the retired updater API; never race an in-flight claim.
SELECT pg_advisory_xact_lock(7419230);
LOCK TABLE "AgentUpdateJob", "AgentRollout", "AgentInstallation", "AgentRelease"
  IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "AgentUpdateJob"
    WHERE "activeKey" IS NOT NULL
      OR "status" NOT IN ('SUCCEEDED', 'ROLLED_BACK', 'FAILED', 'CANCELED')
  ) THEN
    RAISE EXCEPTION 'Agent updater retirement refused: unfinished update jobs remain';
  END IF;
  IF EXISTS (SELECT 1 FROM "AgentRollout" WHERE "status" = 'RUNNING') THEN
    RAISE EXCEPTION 'Agent updater retirement refused: a rollout is still running';
  END IF;
END $$;

DROP TABLE IF EXISTS "AgentUpdateJob";
DROP TABLE IF EXISTS "AgentRollout";
DROP TABLE IF EXISTS "AgentInstallation";
DROP TABLE IF EXISTS "AgentRelease";
DELETE FROM "Setting" WHERE "key" = 'agentUpdates.signingKey';

-- PostgreSQL cannot drop one enum value, so recreate the type without it.
DELETE FROM "AdminPermissionGrant" WHERE "permission"::text = 'AGENT_UPDATES_MANAGE';
ALTER TYPE "AdminPermission" RENAME TO "AdminPermission_old";
CREATE TYPE "AdminPermission" AS ENUM ('DESTINATION_AUDIT_READ', 'ADMIN_PERMISSIONS_MANAGE', 'SEO_CONTENT_MANAGE');
ALTER TABLE "AdminPermissionGrant"
  ALTER COLUMN "permission" TYPE "AdminPermission"
  USING ("permission"::text::"AdminPermission");
DROP TYPE "AdminPermission_old";
COMMIT;
