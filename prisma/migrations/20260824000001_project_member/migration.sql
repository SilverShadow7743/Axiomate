-- CreateTable
CREATE TABLE "ProjectMember" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "person" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectRoleId" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateIndex
CREATE INDEX "ProjectMember_tenantId_projectId_personId_idx" ON "ProjectMember"("tenantId", "projectId", "personId");

-- CreateIndex
CREATE INDEX "ProjectMember_tenantId_personId_idx" ON "ProjectMember"("tenantId", "personId");

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "HierarchyNode"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
