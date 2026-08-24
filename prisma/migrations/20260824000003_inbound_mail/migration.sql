-- CreateTable
CREATE TABLE "InboundMail" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "mailbox" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "issueId" TEXT,
    "refusalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundMail_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateIndex
CREATE INDEX "InboundMail_tenantId_messageId_idx" ON "InboundMail"("tenantId", "messageId");

-- AddForeignKey
ALTER TABLE "InboundMail" ADD CONSTRAINT "InboundMail_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
