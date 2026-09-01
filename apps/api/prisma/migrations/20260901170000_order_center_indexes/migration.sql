CREATE INDEX "EpayPaymentAttempt_paymentType_status_createdAt_id_idx"
ON "EpayPaymentAttempt"("paymentType", "status", "createdAt", "id");

CREATE INDEX "PaymentRecord_source_status_paidAt_id_idx"
ON "PaymentRecord"("source", "status", "paidAt", "id");
