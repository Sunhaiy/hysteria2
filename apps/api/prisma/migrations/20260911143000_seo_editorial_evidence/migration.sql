ALTER TABLE "SeoArticleRevision"
ADD COLUMN "sourceEvidence" JSONB,
ADD COLUMN "aiAudit" JSONB,
ADD COLUMN "lastVerifiedAt" TIMESTAMP(3);
