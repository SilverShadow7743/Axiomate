-- CreateTable
CREATE TABLE "ScopeItem" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "sowId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "parentId" TEXT,
    "effortHours" DECIMAL(10,2),
    "source" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "recordedBy" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ScopeItem_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateIndex
CREATE INDEX "ScopeItem_tenantId_sowId_sequence_idx" ON "ScopeItem"("tenantId", "sowId", "sequence");

-- CreateIndex
CREATE INDEX "ScopeItem_tenantId_parentId_idx" ON "ScopeItem"("tenantId", "parentId");

-- AddForeignKey
ALTER TABLE "ScopeItem" ADD CONSTRAINT "ScopeItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeItem" ADD CONSTRAINT "ScopeItem_tenantId_sowId_fkey" FOREIGN KEY ("tenantId", "sowId") REFERENCES "Sow"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

