ALTER TABLE "AccessAccount"
ADD COLUMN "trafficMultiplierOverrideBasisPoints" INTEGER;

ALTER TABLE "CatalogProduct"
ADD COLUMN "storeUrl" TEXT,
ADD COLUMN "speedUpMbps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "speedDownMbps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "defaultTrafficMultiplierBasisPoints" INTEGER NOT NULL DEFAULT 10000;

UPDATE "CatalogProduct" AS product
SET
  "speedUpMbps" = profile."speedUpMbps",
  "speedDownMbps" = profile."speedDownMbps"
FROM "AccessProfile" AS profile
WHERE product."accessProfileId" = profile."id";

ALTER TABLE "CatalogProduct"
ADD CONSTRAINT "CatalogProduct_speedUpMbps_check" CHECK ("speedUpMbps" >= 0),
ADD CONSTRAINT "CatalogProduct_speedDownMbps_check" CHECK ("speedDownMbps" >= 0),
ADD CONSTRAINT "CatalogProduct_defaultTrafficMultiplierBasisPoints_check"
  CHECK ("defaultTrafficMultiplierBasisPoints" BETWEEN 1000 AND 1000000);

ALTER TABLE "AccessAccount"
ADD CONSTRAINT "AccessAccount_trafficMultiplierOverrideBasisPoints_check"
  CHECK (
    "trafficMultiplierOverrideBasisPoints" IS NULL
    OR "trafficMultiplierOverrideBasisPoints" BETWEEN 1000 AND 1000000
  );
