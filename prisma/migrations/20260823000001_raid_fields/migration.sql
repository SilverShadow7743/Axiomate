-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "decisionOutcome" TEXT,
ADD COLUMN     "riskImpact" INTEGER,
ADD COLUMN     "riskLikelihood" INTEGER;
