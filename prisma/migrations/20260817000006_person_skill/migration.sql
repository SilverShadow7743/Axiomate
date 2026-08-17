-- CreateTable
CREATE TABLE "PersonSkill" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "assessedBy" TEXT,
    "lastUsedOn" TEXT,
    "note" TEXT NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PersonSkill_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateIndex
CREATE INDEX "PersonSkill_tenantId_skillId_level_idx" ON "PersonSkill"("tenantId", "skillId", "level");

-- CreateIndex
CREATE INDEX "PersonSkill_tenantId_personId_idx" ON "PersonSkill"("tenantId", "personId");

-- AddForeignKey
ALTER TABLE "PersonSkill" ADD CONSTRAINT "PersonSkill_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
