-- CreateTable
CREATE TABLE "PersonalEvent" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL,
    "attendees" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PersonalEvent_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateIndex
CREATE INDEX "PersonalEvent_tenantId_personId_idx" ON "PersonalEvent"("tenantId", "personId");

-- AddForeignKey
ALTER TABLE "PersonalEvent" ADD CONSTRAINT "PersonalEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
