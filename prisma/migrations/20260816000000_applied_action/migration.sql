-- CreateTable
CREATE TABLE "AppliedAction" (
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppliedAction_pkey" PRIMARY KEY ("tenantId","key")
);

-- CreateIndex
CREATE INDEX "AppliedAction_tenantId_at_idx" ON "AppliedAction"("tenantId", "at");

-- AddForeignKey
ALTER TABLE "AppliedAction" ADD CONSTRAINT "AppliedAction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

