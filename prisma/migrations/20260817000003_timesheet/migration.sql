-- CreateTable
CREATE TABLE "Timesheet" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "person" TEXT NOT NULL,
    "weekStarting" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "reason" TEXT,

    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateIndex
CREATE INDEX "Timesheet_tenantId_status_idx" ON "Timesheet"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Timesheet_tenantId_person_weekStarting_key" ON "Timesheet"("tenantId", "person", "weekStarting");

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

