-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "supersedesId" TEXT;

-- CreateTable
CREATE TABLE "DocumentReview" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "askedBy" TEXT NOT NULL,
    "askedAt" TIMESTAMP(3) NOT NULL,
    "reviewers" JSONB NOT NULL,
    "verdicts" JSONB NOT NULL,
    "withdrawnAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentReview_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateIndex
CREATE INDEX "DocumentReview_tenantId_documentId_idx" ON "DocumentReview"("tenantId", "documentId");

-- CreateIndex
CREATE INDEX "DocumentReview_tenantId_issueId_idx" ON "DocumentReview"("tenantId", "issueId");

-- AddForeignKey
ALTER TABLE "DocumentReview" ADD CONSTRAINT "DocumentReview_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

