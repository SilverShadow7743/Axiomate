-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "Allocation" ADD COLUMN     "personId" TEXT;

-- AlterTable
ALTER TABLE "Commitment" ADD COLUMN     "personId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "toId" TEXT;

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "personId" TEXT;

-- AlterTable
ALTER TABLE "Timesheet" ADD COLUMN     "personId" TEXT;

