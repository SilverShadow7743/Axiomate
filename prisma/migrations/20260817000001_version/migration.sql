-- CreateTable
CREATE TABLE "Version" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "validFrom" TEXT NOT NULL,
    "validTo" TEXT,
    "value" JSONB NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "by" TEXT NOT NULL,
    "byId" TEXT,
    "byEmail" TEXT,
    "reason" TEXT NOT NULL,

    CONSTRAINT "Version_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateIndex
CREATE INDEX "Version_tenantId_subjectKind_subjectId_validFrom_idx" ON "Version"("tenantId", "subjectKind", "subjectId", "validFrom");

-- AddForeignKey
ALTER TABLE "Version" ADD CONSTRAINT "Version_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

