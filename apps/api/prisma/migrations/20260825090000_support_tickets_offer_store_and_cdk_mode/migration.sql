CREATE TYPE "RedemptionPlanMode" AS ENUM ('RENEW', 'REPLACE');
CREATE TYPE "SupportTicketCategory" AS ENUM ('ACCESS', 'BILLING', 'TECHNICAL', 'OTHER');
CREATE TYPE "SupportTicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');
CREATE TYPE "SupportTicketStatus" AS ENUM ('WAITING_STAFF', 'WAITING_MEMBER', 'CLOSED');

ALTER TABLE "CatalogOffer" ADD COLUMN "storeUrl" TEXT;
ALTER TABLE "RedemptionCode" ADD COLUMN "planMode" "RedemptionPlanMode" NOT NULL DEFAULT 'RENEW';

CREATE TABLE "SupportTicket" (
  "id" TEXT NOT NULL,
  "number" SERIAL NOT NULL,
  "userId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "category" "SupportTicketCategory" NOT NULL DEFAULT 'OTHER',
  "priority" "SupportTicketPriority" NOT NULL DEFAULT 'NORMAL',
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'WAITING_STAFF',
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportTicketMessage" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicketMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupportTicket_number_key" ON "SupportTicket"("number");
CREATE INDEX "SupportTicket_userId_status_lastMessageAt_id_idx" ON "SupportTicket"("userId", "status", "lastMessageAt", "id");
CREATE INDEX "SupportTicket_status_priority_lastMessageAt_id_idx" ON "SupportTicket"("status", "priority", "lastMessageAt", "id");
CREATE INDEX "SupportTicketMessage_ticketId_createdAt_id_idx" ON "SupportTicketMessage"("ticketId", "createdAt", "id");
CREATE INDEX "SupportTicketMessage_authorId_createdAt_id_idx" ON "SupportTicketMessage"("authorId", "createdAt", "id");

ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
