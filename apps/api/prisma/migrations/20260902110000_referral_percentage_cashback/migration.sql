ALTER TABLE "ReferralAttribution"
ADD COLUMN "inviterRewardBasisPoints" INTEGER;

ALTER TABLE "ReferralAttribution"
ADD CONSTRAINT "ReferralAttribution_inviterRewardBasisPoints_check"
CHECK (
  "inviterRewardBasisPoints" IS NULL OR
  (
    "inviterRewardBasisPoints" >= 0 AND
    "inviterRewardBasisPoints" <= 10000
  )
);
