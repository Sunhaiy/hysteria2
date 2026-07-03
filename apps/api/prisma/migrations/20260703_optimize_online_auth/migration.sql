CREATE INDEX "AuthEvent_userId_createdAt_idx"
ON "AuthEvent"("userId", "createdAt");

CREATE INDEX "OnlineSnapshot_nodeId_capturedAt_idx"
ON "OnlineSnapshot"("nodeId", "capturedAt");
