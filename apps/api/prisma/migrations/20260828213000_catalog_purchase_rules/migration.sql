ALTER TABLE "CatalogProduct"
  ADD COLUMN IF NOT EXISTS "featured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "purchaseLimitPerUser" INTEGER,
  ADD COLUMN IF NOT EXISTS "purchaseLimitKey" TEXT,
  ADD COLUMN IF NOT EXISTS "requiresActivePlan" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "referralEligible" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "CatalogProduct_purchaseLimitKey_idx"
  ON "CatalogProduct"("purchaseLimitKey");

ALTER TABLE "CatalogProduct"
  DROP CONSTRAINT IF EXISTS "CatalogProduct_purchaseLimitPerUser_check";

ALTER TABLE "CatalogProduct"
  ADD CONSTRAINT "CatalogProduct_purchaseLimitPerUser_check"
  CHECK ("purchaseLimitPerUser" IS NULL OR "purchaseLimitPerUser" > 0);
