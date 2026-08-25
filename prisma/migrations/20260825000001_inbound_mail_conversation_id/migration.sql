-- Exchange's thread id, stable across every message in the same conversation, unlike
-- messageId. Null for the intake form (not email) and for anything received before the
-- connector was updated to send it. See docs/plans/2026-08-25-intake-reply-threading-design.md.
ALTER TABLE "InboundMail" ADD COLUMN "conversationId" TEXT;
CREATE INDEX "InboundMail_tenantId_conversationId_idx" ON "InboundMail"("tenantId", "conversationId");
