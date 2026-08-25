UPDATE "AccessAccount"
SET "trafficMultiplierOverrideBasisPoints" = "trafficMultiplierBasisPoints"
WHERE "trafficMultiplierBasisPoints" <> 10000
  AND "trafficMultiplierOverrideBasisPoints" IS NULL;
