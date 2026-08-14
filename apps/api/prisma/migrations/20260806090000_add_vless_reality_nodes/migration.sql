-- Add VLESS + REALITY nodes while keeping all existing nodes on Hysteria 2.
CREATE TYPE "NodeProtocol" AS ENUM ('HYSTERIA2', 'VLESS_REALITY');

ALTER TABLE "Node"
  ADD COLUMN "protocol" "NodeProtocol" NOT NULL DEFAULT 'HYSTERIA2',
  ADD COLUMN "realityPublicKey" TEXT,
  ADD COLUMN "realityShortId" TEXT,
  ADD COLUMN "realityFingerprint" TEXT DEFAULT 'chrome',
  ADD COLUMN "realitySpiderX" TEXT,
  ADD COLUMN "vlessFlow" TEXT DEFAULT 'xtls-rprx-vision',
  ADD COLUMN "lastSyncAt" TIMESTAMP(3),
  ADD COLUMN "lastSyncError" TEXT;

-- VLESS clients require a UUID. Keep it separate from the existing Hysteria
-- token so old subscription URLs and Hysteria credentials remain valid.
ALTER TABLE "AccessToken" ADD COLUMN "vlessUuid" TEXT;

UPDATE "AccessToken"
SET "vlessUuid" =
  substr(md5("token"), 1, 8) || '-' ||
  substr(md5("token"), 9, 4) || '-' ||
  '5' || substr(md5("token"), 14, 3) || '-' ||
  'a' || substr(md5("token"), 18, 3) || '-' ||
  substr(md5("token"), 21, 12);

ALTER TABLE "AccessToken" ALTER COLUMN "vlessUuid" SET NOT NULL;
CREATE UNIQUE INDEX "AccessToken_vlessUuid_key" ON "AccessToken"("vlessUuid");
