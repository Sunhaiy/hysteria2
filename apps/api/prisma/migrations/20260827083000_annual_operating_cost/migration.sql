CREATE TABLE "AnnualOperatingCost" (
  "year" INTEGER NOT NULL,
  "totalCostCents" INTEGER NOT NULL,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnnualOperatingCost_pkey" PRIMARY KEY ("year")
);

CREATE INDEX "AnnualOperatingCost_updatedAt_idx"
  ON "AnnualOperatingCost"("updatedAt");

ALTER TABLE "AnnualOperatingCost"
  ADD CONSTRAINT "AnnualOperatingCost_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
