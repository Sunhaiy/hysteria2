CREATE TYPE "NodeRuntimeAction" AS ENUM ('START', 'STOP', 'STATUS');
CREATE TYPE "NodeRuntimeCommandStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "NodeRuntimeState" AS ENUM ('UNKNOWN', 'ACTIVE', 'INACTIVE', 'ACTIVATING', 'DEACTIVATING', 'FAILED');

ALTER TABLE "Node"
  ADD COLUMN "controlApiBaseUrl" TEXT,
  ADD COLUMN "controlApiSecret" TEXT,
  ADD COLUMN "runtimeState" "NodeRuntimeState" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "runtimeStateObservedAt" TIMESTAMP(3),
  ADD COLUMN "runtimeError" TEXT;

CREATE TABLE "NodeRuntimeCommand" (
  "id" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "requestedById" TEXT,
  "action" "NodeRuntimeAction" NOT NULL,
  "status" "NodeRuntimeCommandStatus" NOT NULL DEFAULT 'QUEUED',
  "idempotencyKey" TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "resultState" "NodeRuntimeState",
  "error" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "NodeRuntimeCommand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NodeRuntimeCommand_idempotencyKey_key"
  ON "NodeRuntimeCommand"("idempotencyKey");
CREATE INDEX "NodeRuntimeCommand_status_requestedAt_id_idx"
  ON "NodeRuntimeCommand"("status", "requestedAt", "id");
CREATE INDEX "NodeRuntimeCommand_nodeId_requestedAt_id_idx"
  ON "NodeRuntimeCommand"("nodeId", "requestedAt", "id");
CREATE UNIQUE INDEX "NodeRuntimeCommand_nodeId_active_key"
  ON "NodeRuntimeCommand"("nodeId")
  WHERE "status" IN ('QUEUED', 'RUNNING');

ALTER TABLE "NodeRuntimeCommand"
  ADD CONSTRAINT "NodeRuntimeCommand_nodeId_fkey"
  FOREIGN KEY ("nodeId") REFERENCES "Node"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
