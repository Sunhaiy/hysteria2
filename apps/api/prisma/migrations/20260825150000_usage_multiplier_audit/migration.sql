ALTER TABLE "UsageRollup"
ADD COLUMN "rawBytes" BIGINT,
ADD COLUMN "multiplierBasisPoints" INTEGER;

-- Keep this migration metadata-only for the large production rollup table.
-- New imports populate both nullable audit columns. Historical reads retain
-- their txBytes + rxBytes fallback and can be backfilled later in small batches.
