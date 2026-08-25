CREATE TABLE "AnnouncementAcknowledgement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "announcementVersion" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementAcknowledgement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnnouncementAcknowledgement_userId_announcementVersion_key"
ON "AnnouncementAcknowledgement"("userId", "announcementVersion");

CREATE INDEX "AnnouncementAcknowledgement_announcementVersion_acknowledgedAt_idx"
ON "AnnouncementAcknowledgement"("announcementVersion", "acknowledgedAt");

ALTER TABLE "AnnouncementAcknowledgement"
ADD CONSTRAINT "AnnouncementAcknowledgement_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
