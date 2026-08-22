-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "clientVisible" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "IssueNote" ADD COLUMN     "clientVisible" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "clientVisible" BOOLEAN NOT NULL DEFAULT false;

