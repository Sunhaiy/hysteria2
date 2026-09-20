ALTER TABLE "SeoGenerationJob"
  ADD COLUMN "inputSnapshot" JSONB,
  ADD COLUMN "research" JSONB,
  ADD COLUMN "checkpoints" JSONB,
  ADD COLUMN "progress" TEXT;
