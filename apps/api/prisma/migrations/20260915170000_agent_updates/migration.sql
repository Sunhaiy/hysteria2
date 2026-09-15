ALTER TYPE "AdminPermission" ADD VALUE IF NOT EXISTS 'AGENT_UPDATES_MANAGE';

CREATE TABLE "AgentRelease" (
 "id" TEXT PRIMARY KEY, "version" TEXT NOT NULL, "architecture" TEXT NOT NULL,
 "sha256" TEXT NOT NULL, "size" INTEGER NOT NULL, "manifest" TEXT NOT NULL,
 "signature" TEXT NOT NULL, "binary" BYTEA NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdBy" TEXT NOT NULL,
 CONSTRAINT "AgentRelease_arch_check" CHECK ("architecture" IN ('amd64','arm64')),
 CONSTRAINT "AgentRelease_size_check" CHECK ("size" BETWEEN 64 AND 67108864)
);
CREATE UNIQUE INDEX "AgentRelease_version_architecture_key" ON "AgentRelease"("version","architecture");
CREATE TABLE "AgentInstallation" (
 "id" TEXT PRIMARY KEY, "serverId" TEXT NOT NULL REFERENCES "NodeServer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "serviceUnit" TEXT NOT NULL, "architecture" TEXT NOT NULL, "tokenHash" TEXT NOT NULL,
 "currentVersion" TEXT NOT NULL DEFAULT '未连接', "currentSha256" TEXT NOT NULL DEFAULT '',
 "lastSeenAt" TIMESTAMP(3), "enabled" BOOLEAN NOT NULL DEFAULT true,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AgentInstallation_tokenHash_key" ON "AgentInstallation"("tokenHash");
CREATE UNIQUE INDEX "AgentInstallation_serverId_serviceUnit_key" ON "AgentInstallation"("serverId","serviceUnit");
CREATE TABLE "AgentRollout" (
 "id" TEXT PRIMARY KEY, "releaseId" TEXT NOT NULL REFERENCES "AgentRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "idempotencyKey" TEXT NOT NULL, "targetHash" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'RUNNING', "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AgentRollout_status_check" CHECK ("status" IN ('RUNNING','PAUSED','SUCCEEDED','CANCELED'))
);
CREATE UNIQUE INDEX "AgentRollout_idempotencyKey_key" ON "AgentRollout"("idempotencyKey");
CREATE TABLE "AgentUpdateJob" (
 "id" TEXT PRIMARY KEY, "rolloutId" TEXT NOT NULL REFERENCES "AgentRollout"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "installationId" TEXT NOT NULL REFERENCES "AgentInstallation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "position" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'QUEUED',
 "activeKey" TEXT, "message" TEXT NOT NULL DEFAULT '', "startedAt" TIMESTAMP(3),
 "updatedAt" TIMESTAMP(3) NOT NULL, "finishedAt" TIMESTAMP(3),
 CONSTRAINT "AgentUpdateJob_status_check" CHECK ("status" IN ('QUEUED','DOWNLOADING','VERIFYING','INSTALLING','CHECKING','ROLLING_BACK','SUCCEEDED','ROLLED_BACK','FAILED','CANCELED'))
);
CREATE UNIQUE INDEX "AgentUpdateJob_activeKey_key" ON "AgentUpdateJob"("activeKey");
CREATE UNIQUE INDEX "AgentUpdateJob_rolloutId_position_key" ON "AgentUpdateJob"("rolloutId","position");
CREATE INDEX "AgentUpdateJob_installationId_status_idx" ON "AgentUpdateJob"("installationId","status");
