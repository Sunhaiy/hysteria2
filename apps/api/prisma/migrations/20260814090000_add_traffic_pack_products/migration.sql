CREATE TABLE "TrafficPackProduct" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "trafficBytes" BIGINT NOT NULL,
  "validityDays" INTEGER,
  "priceCents" INTEGER NOT NULL,
  "accent" TEXT NOT NULL DEFAULT 'teal',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TrafficPackProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrafficPackProduct_slug_key" ON "TrafficPackProduct"("slug");
