-- CreateTable
CREATE TABLE "PersonRate" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "validFrom" TEXT NOT NULL,
    "validTo" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "by" TEXT NOT NULL,
    "byId" TEXT,
    "byEmail" TEXT,
    "reason" TEXT NOT NULL,

    CONSTRAINT "PersonRate_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateIndex
CREATE INDEX "PersonRate_tenantId_personId_kind_validFrom_idx" ON "PersonRate"("tenantId", "personId", "kind", "validFrom");

-- AddForeignKey
ALTER TABLE "PersonRate" ADD CONSTRAINT "PersonRate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

