CREATE TABLE "NodeAccessRevocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NodeAccessRevocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NodeAccessRevocation_status_check" CHECK ("status" IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'CANCELED'))
);
CREATE UNIQUE INDEX "NodeAccessRevocation_userId_nodeId_key" ON "NodeAccessRevocation"("userId", "nodeId");
CREATE INDEX "NodeAccessRevocation_status_nextAttemptAt_idx" ON "NodeAccessRevocation"("status", "nextAttemptAt");
CREATE INDEX "NodeAccessRevocation_status_leaseUntil_idx" ON "NodeAccessRevocation"("status", "leaseUntil");

