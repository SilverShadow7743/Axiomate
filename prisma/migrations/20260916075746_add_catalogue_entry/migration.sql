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

-- RowLevelSecurity: CatalogueEntry is tenant-scoped ("tenantId" is part of its own primary key,
-- same shape as every table below). New tables get RLS in their own creation migration, per the
-- discipline every table since 20260824000004_row_level_security has followed (see that
-- migration's header for why FORCE, not just ENABLE, is required). The tenant-composite FKs
-- above constrain what HierarchyNode/ScopeItem may *link to*; they do nothing to protect a
-- direct query or mutation against CatalogueEntry itself that omits an explicit tenantId filter
-- — this policy is that backstop.
ALTER TABLE "CatalogueEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CatalogueEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CatalogueEntry"
  USING ("tenantId" = current_setting('app.tenant_id', true));
