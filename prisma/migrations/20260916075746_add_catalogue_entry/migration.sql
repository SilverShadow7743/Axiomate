-- AlterTable
ALTER TABLE "HierarchyNode" ADD COLUMN     "catalogueEntryId" TEXT;

-- AlterTable
ALTER TABLE "ScopeItem" ADD COLUMN     "catalogueEntryId" TEXT;

-- CreateTable
CREATE TABLE "CatalogueEntry" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "alternateId" TEXT,
    "workbookVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogueEntry_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateIndex
CREATE INDEX "HierarchyNode_tenantId_catalogueEntryId_idx" ON "HierarchyNode"("tenantId", "catalogueEntryId");

-- CreateIndex
CREATE INDEX "ScopeItem_tenantId_catalogueEntryId_idx" ON "ScopeItem"("tenantId", "catalogueEntryId");

-- AddForeignKey
ALTER TABLE "HierarchyNode" ADD CONSTRAINT "HierarchyNode_tenantId_catalogueEntryId_fkey" FOREIGN KEY ("tenantId", "catalogueEntryId") REFERENCES "CatalogueEntry"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeItem" ADD CONSTRAINT "ScopeItem_tenantId_catalogueEntryId_fkey" FOREIGN KEY ("tenantId", "catalogueEntryId") REFERENCES "CatalogueEntry"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogueEntry" ADD CONSTRAINT "CatalogueEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
