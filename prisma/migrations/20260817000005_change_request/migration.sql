-- CreateTable
CREATE TABLE "ChangeRequest" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "sowId" TEXT NOT NULL,
    "issueId" TEXT,
    "reference" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "effortHours" INTEGER NOT NULL DEFAULT 0,
    "value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "scope" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "effectiveFrom" TEXT,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateIndex
CREATE INDEX "ChangeRequest_tenantId_sowId_status_idx" ON "ChangeRequest"("tenantId", "sowId", "status");

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_tenantId_sowId_fkey" FOREIGN KEY ("tenantId", "sowId") REFERENCES "Sow"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

