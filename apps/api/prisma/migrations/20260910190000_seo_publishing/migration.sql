ALTER TYPE "AdminPermission" ADD VALUE IF NOT EXISTS 'SEO_CONTENT_MANAGE';

CREATE TYPE "SeoArticleStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "SeoRevisionSource" AS ENUM ('AI', 'MANUAL');
CREATE TYPE "SeoKeywordStatus" AS ENUM ('ACTIVE', 'PAUSED', 'USED');
CREATE TYPE "SeoGenerationStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "SeoImageSource" AS ENUM ('AI', 'UPLOAD');
CREATE TYPE "SeoIndexEngine" AS ENUM ('BING_INDEXNOW', 'GOOGLE_SITEMAP');
CREATE TYPE "SeoIndexOperation" AS ENUM ('PUBLISH', 'UPDATE', 'ARCHIVE');
CREATE TYPE "SeoIndexStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "SeoArticle" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT '教程',
  "status" "SeoArticleStatus" NOT NULL DEFAULT 'DRAFT',
  "draftRevisionId" TEXT,
  "publishedRevisionId" TEXT,
  "createdById" TEXT,
  "scheduledAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoArticle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoArticleRevision" (
  "id" TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "source" "SeoRevisionSource" NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "excerpt" TEXT NOT NULL,
  "contentJson" JSONB NOT NULL,
  "contentHtml" TEXT NOT NULL,
  "primaryKeyword" TEXT NOT NULL,
  "relatedKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "seoTitle" TEXT NOT NULL,
  "metaDescription" TEXT NOT NULL,
  "coverImageId" TEXT,
  "coverAlt" TEXT,
  "qualityScore" INTEGER NOT NULL DEFAULT 0,
  "qualityReport" JSONB NOT NULL,
  "modelSnapshot" JSONB,
  "promptVersion" TEXT,
  "createdById" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoArticleRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoKeyword" (
  "id" TEXT NOT NULL,
  "keyword" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT '教程',
  "searchIntent" TEXT,
  "status" "SeoKeywordStatus" NOT NULL DEFAULT 'ACTIVE',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "articleId" TEXT,
  "lastGeneratedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoKeyword_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoGenerationJob" (
  "id" TEXT NOT NULL,
  "keywordId" TEXT,
  "articleId" TEXT,
  "requestedById" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "status" "SeoGenerationStatus" NOT NULL DEFAULT 'QUEUED',
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "modelSnapshot" JSONB,
  "usage" JSONB,
  "lastError" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoGenerationJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoImage" (
  "id" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "source" "SeoImageSource" NOT NULL,
  "mimeType" TEXT NOT NULL DEFAULT 'image/webp',
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "originalName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoImage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoIndexSubmission" (
  "id" TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "revisionId" TEXT,
  "engine" "SeoIndexEngine" NOT NULL,
  "operation" "SeoIndexOperation" NOT NULL,
  "status" "SeoIndexStatus" NOT NULL DEFAULT 'PENDING',
  "url" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt" TIMESTAMP(3),
  "response" JSONB,
  "lastError" TEXT,
  "submittedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoIndexSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoRedirect" (
  "id" TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "fromSlug" TEXT NOT NULL,
  "toSlug" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoRedirect_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoSearchMetric" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "articleId" TEXT,
  "date" DATE NOT NULL,
  "page" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "clicks" INTEGER NOT NULL DEFAULT 0,
  "impressions" INTEGER NOT NULL DEFAULT 0,
  "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoSearchMetric_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SeoArticle_slug_key" ON "SeoArticle"("slug");
CREATE UNIQUE INDEX "SeoArticle_draftRevisionId_key" ON "SeoArticle"("draftRevisionId");
CREATE UNIQUE INDEX "SeoArticle_publishedRevisionId_key" ON "SeoArticle"("publishedRevisionId");
CREATE INDEX "SeoArticle_status_publishedAt_id_idx" ON "SeoArticle"("status", "publishedAt", "id");
CREATE INDEX "SeoArticle_category_status_publishedAt_id_idx" ON "SeoArticle"("category", "status", "publishedAt", "id");
CREATE INDEX "SeoArticle_scheduledAt_status_id_idx" ON "SeoArticle"("scheduledAt", "status", "id");
CREATE UNIQUE INDEX "SeoArticleRevision_articleId_version_key" ON "SeoArticleRevision"("articleId", "version");
CREATE INDEX "SeoArticleRevision_slug_idx" ON "SeoArticleRevision"("slug");
CREATE INDEX "SeoArticleRevision_createdAt_id_idx" ON "SeoArticleRevision"("createdAt", "id");
CREATE UNIQUE INDEX "SeoKeyword_keyword_key" ON "SeoKeyword"("keyword");
CREATE UNIQUE INDEX "SeoKeyword_articleId_key" ON "SeoKeyword"("articleId");
CREATE INDEX "SeoKeyword_status_priority_createdAt_id_idx" ON "SeoKeyword"("status", "priority", "createdAt", "id");
CREATE UNIQUE INDEX "SeoGenerationJob_idempotencyKey_key" ON "SeoGenerationJob"("idempotencyKey");
CREATE INDEX "SeoGenerationJob_status_scheduledFor_id_idx" ON "SeoGenerationJob"("status", "scheduledFor", "id");
CREATE INDEX "SeoGenerationJob_keywordId_createdAt_id_idx" ON "SeoGenerationJob"("keywordId", "createdAt", "id");
CREATE UNIQUE INDEX "SeoImage_storageKey_key" ON "SeoImage"("storageKey");
CREATE INDEX "SeoImage_createdAt_id_idx" ON "SeoImage"("createdAt", "id");
CREATE UNIQUE INDEX "SeoIndexSubmission_idempotencyKey_key" ON "SeoIndexSubmission"("idempotencyKey");
CREATE INDEX "SeoIndexSubmission_status_nextRetryAt_createdAt_id_idx" ON "SeoIndexSubmission"("status", "nextRetryAt", "createdAt", "id");
CREATE INDEX "SeoIndexSubmission_articleId_createdAt_id_idx" ON "SeoIndexSubmission"("articleId", "createdAt", "id");
CREATE UNIQUE INDEX "SeoRedirect_fromSlug_key" ON "SeoRedirect"("fromSlug");
CREATE INDEX "SeoRedirect_articleId_createdAt_idx" ON "SeoRedirect"("articleId", "createdAt");
CREATE UNIQUE INDEX "SeoSearchMetric_fingerprint_key" ON "SeoSearchMetric"("fingerprint");
CREATE INDEX "SeoSearchMetric_date_page_idx" ON "SeoSearchMetric"("date", "page");
CREATE INDEX "SeoSearchMetric_articleId_date_idx" ON "SeoSearchMetric"("articleId", "date");
CREATE INDEX "SeoSearchMetric_impressions_date_idx" ON "SeoSearchMetric"("impressions", "date");

ALTER TABLE "SeoArticle" ADD CONSTRAINT "SeoArticle_draftRevisionId_fkey" FOREIGN KEY ("draftRevisionId") REFERENCES "SeoArticleRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SeoArticle" ADD CONSTRAINT "SeoArticle_publishedRevisionId_fkey" FOREIGN KEY ("publishedRevisionId") REFERENCES "SeoArticleRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SeoArticle" ADD CONSTRAINT "SeoArticle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SeoArticleRevision" ADD CONSTRAINT "SeoArticleRevision_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "SeoArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoArticleRevision" ADD CONSTRAINT "SeoArticleRevision_coverImageId_fkey" FOREIGN KEY ("coverImageId") REFERENCES "SeoImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SeoArticleRevision" ADD CONSTRAINT "SeoArticleRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SeoArticleRevision" ADD CONSTRAINT "SeoArticleRevision_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SeoKeyword" ADD CONSTRAINT "SeoKeyword_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "SeoArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SeoGenerationJob" ADD CONSTRAINT "SeoGenerationJob_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "SeoKeyword"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SeoGenerationJob" ADD CONSTRAINT "SeoGenerationJob_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "SeoArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SeoGenerationJob" ADD CONSTRAINT "SeoGenerationJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SeoIndexSubmission" ADD CONSTRAINT "SeoIndexSubmission_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "SeoArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoIndexSubmission" ADD CONSTRAINT "SeoIndexSubmission_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "SeoArticleRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SeoRedirect" ADD CONSTRAINT "SeoRedirect_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "SeoArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoSearchMetric" ADD CONSTRAINT "SeoSearchMetric_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "SeoArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
