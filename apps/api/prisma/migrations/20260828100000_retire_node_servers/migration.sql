ALTER TABLE "NodeServer"
  ADD COLUMN "retiredAt" TIMESTAMP(3);

ALTER TABLE "Node"
  ADD COLUMN "retiredAt" TIMESTAMP(3);

CREATE INDEX "NodeServer_retiredAt_active_createdAt_idx"
  ON "NodeServer"("retiredAt", "active", "createdAt");

CREATE INDEX "Node_retiredAt_active_createdAt_idx"
  ON "Node"("retiredAt", "active", "createdAt");
