-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN     "documentId" TEXT;

-- CreateTable
CREATE TABLE "Document" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "locator" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateIndex
CREATE INDEX "Document_tenantId_subjectKind_subjectId_idx" ON "Document"("tenantId", "subjectKind", "subjectId");

-- CreateIndex
CREATE INDEX "Document_tenantId_checksum_idx" ON "Document"("tenantId", "checksum");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

