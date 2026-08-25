CREATE TYPE "TutorialPlatform" AS ENUM ('WINDOWS', 'MACOS', 'ANDROID', 'IOS');
CREATE TYPE "TutorialRevisionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

ALTER TABLE "QuotaAdjustment" ADD COLUMN "quotaBucketId" TEXT;
ALTER TABLE "RedemptionCode" ADD COLUMN "catalogOfferId" TEXT;
ALTER TABLE "Node" ADD COLUMN "lastUserSyncAt" TIMESTAMP(3);
ALTER TABLE "Node" ADD COLUMN "lastTrafficAt" TIMESTAMP(3);
ALTER TABLE "Node" ADD COLUMN "lastPresenceAt" TIMESTAMP(3);

UPDATE "Node"
SET "lastUserSyncAt" = "lastSyncAt",
    "lastTrafficAt" = "lastSyncAt";

UPDATE "Node" node
SET "lastPresenceAt" = presence."observedAt"
FROM (
  SELECT "nodeId", MAX("capturedAt") AS "observedAt"
  FROM "OnlineSnapshot"
  GROUP BY "nodeId"
) presence
WHERE presence."nodeId" = node."id";

-- Keep the charged amount untouched and fill only the missing list-price
-- snapshot from the linked period price.
UPDATE "ManualOrder" order_row
SET "basePriceCents" = COALESCE(
  (
    SELECT offer."priceCents"
    FROM "CatalogOffer" offer
    WHERE offer."id" = order_row."catalogOfferId"
  ),
  (
    SELECT offer."priceCents"
    FROM "PlanOffer" offer
    WHERE offer."id" = order_row."planOfferId"
  ),
  order_row."amountCents" + order_row."discountCents"
)
WHERE order_row."basePriceCents" IS NULL;

CREATE TABLE "OnlinePresence" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "concurrentClients" INTEGER NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OnlinePresence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NodeHealthSnapshot" (
  "id" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "healthy" BOOLEAN NOT NULL,
  "agentReachable" BOOLEAN NOT NULL,
  "coreHealthy" BOOLEAN,
  "publicEndpointReachable" BOOLEAN,
  "latencyMs" INTEGER,
  "onlineUsers" INTEGER NOT NULL DEFAULT 0,
  "userSyncAt" TIMESTAMP(3),
  "trafficAt" TIMESTAMP(3),
  "presenceAt" TIMESTAMP(3),
  "error" TEXT,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NodeHealthSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TutorialGuide" (
  "id" TEXT NOT NULL,
  "platform" "TutorialPlatform" NOT NULL,
  "name" TEXT NOT NULL,
  "meta" TEXT NOT NULL,
  "clientName" TEXT NOT NULL,
  "externalUrl" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "publishedRevisionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TutorialGuide_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TutorialRevision" (
  "id" TEXT NOT NULL,
  "guideId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "TutorialRevisionStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  CONSTRAINT "TutorialRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TutorialImage" (
  "id" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TutorialImage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TutorialStep" (
  "id" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "imageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TutorialStep_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OnlinePresence_userId_nodeId_key" ON "OnlinePresence"("userId", "nodeId");
CREATE INDEX "OnlinePresence_observedAt_concurrentClients_idx" ON "OnlinePresence"("observedAt", "concurrentClients");
CREATE INDEX "OnlinePresence_nodeId_observedAt_idx" ON "OnlinePresence"("nodeId", "observedAt");
CREATE INDEX "OnlinePresence_userId_observedAt_idx" ON "OnlinePresence"("userId", "observedAt");
CREATE INDEX "NodeHealthSnapshot_nodeId_checkedAt_idx" ON "NodeHealthSnapshot"("nodeId", "checkedAt");
CREATE INDEX "NodeHealthSnapshot_healthy_checkedAt_idx" ON "NodeHealthSnapshot"("healthy", "checkedAt");
CREATE UNIQUE INDEX "TutorialGuide_platform_key" ON "TutorialGuide"("platform");
CREATE UNIQUE INDEX "TutorialGuide_publishedRevisionId_key" ON "TutorialGuide"("publishedRevisionId");
CREATE UNIQUE INDEX "TutorialRevision_guideId_version_key" ON "TutorialRevision"("guideId", "version");
CREATE INDEX "TutorialRevision_guideId_status_createdAt_idx" ON "TutorialRevision"("guideId", "status", "createdAt");
CREATE UNIQUE INDEX "TutorialImage_storageKey_key" ON "TutorialImage"("storageKey");
CREATE UNIQUE INDEX "TutorialStep_revisionId_sortOrder_key" ON "TutorialStep"("revisionId", "sortOrder");
CREATE INDEX "TutorialStep_imageId_idx" ON "TutorialStep"("imageId");

ALTER TABLE "QuotaAdjustment" ADD CONSTRAINT "QuotaAdjustment_quotaBucketId_fkey"
  FOREIGN KEY ("quotaBucketId") REFERENCES "QuotaBucket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RedemptionCode" ADD CONSTRAINT "RedemptionCode_catalogOfferId_fkey"
  FOREIGN KEY ("catalogOfferId") REFERENCES "CatalogOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OnlinePresence" ADD CONSTRAINT "OnlinePresence_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OnlinePresence" ADD CONSTRAINT "OnlinePresence_nodeId_fkey"
  FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NodeHealthSnapshot" ADD CONSTRAINT "NodeHealthSnapshot_nodeId_fkey"
  FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TutorialRevision" ADD CONSTRAINT "TutorialRevision_guideId_fkey"
  FOREIGN KEY ("guideId") REFERENCES "TutorialGuide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TutorialGuide" ADD CONSTRAINT "TutorialGuide_publishedRevisionId_fkey"
  FOREIGN KEY ("publishedRevisionId") REFERENCES "TutorialRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TutorialStep" ADD CONSTRAINT "TutorialStep_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "TutorialRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TutorialStep" ADD CONSTRAINT "TutorialStep_imageId_fkey"
  FOREIGN KEY ("imageId") REFERENCES "TutorialImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Convert legacy newline-delimited tutorial settings into published revisions.
INSERT INTO "TutorialGuide" (
  "id", "platform", "name", "meta", "clientName", "externalUrl", "active", "createdAt", "updatedAt"
)
VALUES
  (
    'tutorial_guide_windows', 'WINDOWS', 'Windows', '电脑',
    COALESCE(NULLIF((SELECT replace("value", 'v2rayN', 'Clash Verge Rev') FROM "Setting" WHERE "key" = 'tutorial.windows.client'), ''), 'Clash Verge Rev'),
    NULLIF(COALESCE((SELECT "value" FROM "Setting" WHERE "key" = 'tutorial.windows.url'), ''), ''),
    true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'tutorial_guide_macos', 'MACOS', 'macOS', 'Mac', 'Clash Verge Rev',
    NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'tutorial_guide_android', 'ANDROID', 'Android', '手机 / 平板',
    COALESCE(NULLIF((SELECT replace("value", 'Hiddify', 'FlClash') FROM "Setting" WHERE "key" = 'tutorial.android.client'), ''), 'FlClash'),
    NULLIF(COALESCE((SELECT "value" FROM "Setting" WHERE "key" = 'tutorial.android.url'), ''), ''),
    true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'tutorial_guide_ios', 'IOS', 'iOS', 'iPhone / iPad',
    COALESCE(NULLIF((SELECT replace("value", 'sing-box', 'Stash') FROM "Setting" WHERE "key" = 'tutorial.ios.client'), ''), 'Stash'),
    NULLIF(COALESCE((SELECT "value" FROM "Setting" WHERE "key" = 'tutorial.ios.url'), ''), ''),
    true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT ("platform") DO NOTHING;

INSERT INTO "TutorialRevision" (
  "id", "guideId", "version", "status", "createdAt", "publishedAt"
)
SELECT
  'tutorial_revision_' || lower(guide."platform"::text),
  guide."id",
  1,
  'PUBLISHED',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "TutorialGuide" guide
WHERE NOT EXISTS (
  SELECT 1 FROM "TutorialRevision" revision WHERE revision."guideId" = guide."id"
);

WITH tutorial_sources AS (
  SELECT
    guide."id" AS "guideId",
    revision."id" AS "revisionId",
    lower(guide."platform"::text) AS platform,
    CASE guide."platform"
      WHEN 'WINDOWS' THEN COALESCE(
        (SELECT replace("value", 'v2rayN', 'Clash Verge Rev') FROM "Setting" WHERE "key" = 'tutorial.windows.steps'),
        '下载并安装 Clash Verge Rev 客户端' || E'\n' ||
        '复制 Mihomo 订阅链接' || E'\n' ||
        '在 Clash Verge Rev 中添加并更新订阅' || E'\n' ||
        '选择自动节点并启用系统代理'
      )
      WHEN 'MACOS' THEN
        '下载并安装 Clash Verge Rev 客户端' || E'\n' ||
        '复制 Mihomo 订阅链接' || E'\n' ||
        '在 Clash Verge Rev 中添加并更新订阅' || E'\n' ||
        '选择自动节点并启用系统代理'
      WHEN 'ANDROID' THEN COALESCE(
        (SELECT replace("value", 'Hiddify', 'FlClash') FROM "Setting" WHERE "key" = 'tutorial.android.steps'),
        '下载并安装 FlClash 客户端' || E'\n' ||
        '复制 Mihomo 订阅链接' || E'\n' ||
        '在 FlClash 中添加并更新订阅' || E'\n' ||
        '选择自动节点并允许 VPN 权限'
      )
      ELSE COALESCE(
        (SELECT replace("value", 'sing-box', 'Stash') FROM "Setting" WHERE "key" = 'tutorial.ios.steps'),
        '从 App Store 安装 Stash' || E'\n' ||
        '复制 Mihomo 订阅链接' || E'\n' ||
        '在 Stash 中添加并更新订阅' || E'\n' ||
        '选择自动节点并允许 VPN 权限'
      )
    END AS steps
  FROM "TutorialGuide" guide
  JOIN "TutorialRevision" revision
    ON revision."guideId" = guide."id" AND revision."version" = 1
), split_steps AS (
  SELECT
    source."revisionId",
    source.platform,
    trim(step.text) AS title,
    step.ordinality - 1 AS "sortOrder"
  FROM tutorial_sources source
  CROSS JOIN LATERAL regexp_split_to_table(source.steps, E'\r?\n')
    WITH ORDINALITY AS step(text, ordinality)
  WHERE trim(step.text) <> ''
)
INSERT INTO "TutorialStep" (
  "id", "revisionId", "title", "body", "sortOrder", "createdAt", "updatedAt"
)
SELECT
  'tutorial_step_' || substr(md5(split_steps.platform || ':' || split_steps."sortOrder"::text), 1, 24),
  split_steps."revisionId",
  split_steps.title,
  CASE WHEN split_steps."sortOrder" = 1
    THEN '复制接入页中的 Mihomo YAML 订阅链接，不要分享给其他人。'
    ELSE '按客户端界面完成此步骤。'
  END,
  split_steps."sortOrder",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM split_steps
ON CONFLICT ("revisionId", "sortOrder") DO NOTHING;

UPDATE "TutorialGuide" guide
SET "publishedRevisionId" = revision."id", "updatedAt" = CURRENT_TIMESTAMP
FROM "TutorialRevision" revision
WHERE revision."guideId" = guide."id"
  AND revision."version" = 1
  AND guide."publishedRevisionId" IS NULL;

-- Expand the effective pool access set into the existing direct bindings.
-- Pool-backed profiles continue to read from pools until the new release is
-- active, so these writes cannot remove access from the deployed version.
CREATE TEMP TABLE "_ExpectedAccessProfileNode" AS
SELECT direct."accessProfileId", direct."nodeId"
FROM "AccessProfileNode" direct
UNION
SELECT binding."accessProfileId", member."nodeId"
FROM "AccessProfilePool" binding
JOIN "NodePoolMember" member ON member."poolId" = binding."poolId";

INSERT INTO "AccessProfileNode" (
  "id", "accessProfileId", "nodeId", "priority", "createdAt"
)
SELECT
  'direct_' || substr(md5(binding."accessProfileId" || ':' || member."nodeId"), 1, 20),
  binding."accessProfileId",
  member."nodeId",
  MIN(binding."priority" * 10000 + member."priority"),
  CURRENT_TIMESTAMP
FROM "AccessProfilePool" binding
JOIN "NodePoolMember" member ON member."poolId" = binding."poolId"
GROUP BY binding."accessProfileId", member."nodeId"
ON CONFLICT ("accessProfileId", "nodeId") DO NOTHING;

-- A profile that used pools must resolve to exactly the same node set after
-- switching to direct bindings. Abort the migration rather than broaden or
-- narrow an active customer's access.
DO $$
BEGIN
  IF EXISTS (
    (
      SELECT expected."accessProfileId", expected."nodeId"
      FROM "_ExpectedAccessProfileNode" expected
      EXCEPT
      SELECT direct."accessProfileId", direct."nodeId"
      FROM "AccessProfileNode" direct
    )
    UNION ALL
    (
      SELECT direct."accessProfileId", direct."nodeId"
      FROM "AccessProfileNode" direct
      EXCEPT
      SELECT expected."accessProfileId", expected."nodeId"
      FROM "_ExpectedAccessProfileNode" expected
    )
  ) THEN
    RAISE EXCEPTION 'Direct node bindings differ from the pre-migration effective access set';
  END IF;
END $$;
