ALTER TABLE "ManualOrder"
ADD COLUMN "planId" TEXT;

CREATE INDEX "ManualOrder_planId_status_createdAt_idx"
ON "ManualOrder"("planId", "status", "createdAt");

ALTER TABLE "ManualOrder"
ADD CONSTRAINT "ManualOrder_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "Plan"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
