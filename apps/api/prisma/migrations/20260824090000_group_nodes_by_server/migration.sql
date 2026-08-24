-- A server is the physical host; Node remains a protocol endpoint. The
-- nullable foreign key lets the currently deployed API keep creating nodes
-- while this additive migration is being rolled out.
CREATE TABLE "NodeServer" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "region" TEXT,
  "provider" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NodeServer_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Node" ADD COLUMN "serverId" TEXT;

CREATE UNIQUE INDEX "NodeServer_slug_key" ON "NodeServer"("slug");
CREATE UNIQUE INDEX "NodeServer_hostname_key" ON "NodeServer"("hostname");
CREATE INDEX "NodeServer_active_createdAt_idx" ON "NodeServer"("active", "createdAt");
CREATE INDEX "Node_serverId_active_idx" ON "Node"("serverId", "active");

INSERT INTO "NodeServer" (
  "id", "slug", "name", "hostname", "region", "provider", "active", "createdAt", "updatedAt"
)
SELECT
  'server_' || substr(md5("hostname"), 1, 17),
  'server-' || substr(md5("hostname"), 1, 16),
  "hostname",
  "hostname",
  MAX("region"),
  MAX("provider"),
  BOOL_OR("active"),
  MIN("createdAt"),
  MAX("updatedAt")
FROM "Node"
GROUP BY "hostname";

UPDATE "Node" AS node
SET "serverId" = server."id"
FROM "NodeServer" AS server
WHERE server."hostname" = node."hostname";

ALTER TABLE "Node"
  ADD CONSTRAINT "Node_serverId_fkey"
  FOREIGN KEY ("serverId") REFERENCES "NodeServer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
