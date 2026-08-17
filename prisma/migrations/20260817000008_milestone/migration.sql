-- CreateTable
CREATE TABLE "Milestone" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "sowId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "basis" TEXT NOT NULL,
    "percentage" DECIMAL(6,3),
    "amount" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "billOn" TEXT NOT NULL,
    "plannedDate" TEXT,
    "delivery" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "deliveredBy" TEXT,
    "acceptance" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedBy" TEXT,
    "rejectionNote" TEXT,
    "acceptedValue" DECIMAL(14,2),
    "evidenceDocumentId" TEXT,
    "recordedBy" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateIndex
CREATE INDEX "Milestone_tenantId_sowId_sequence_idx" ON "Milestone"("tenantId", "sowId", "sequence");

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_tenantId_sowId_fkey" FOREIGN KEY ("tenantId", "sowId") REFERENCES "Sow"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

