-- Meetings (E4): the availability engine's fourth term gets its table. Boot-shipped like
-- commitments — the design doc records the stated deviation from the server-queried rule.
-- Forced RLS, the 20260824000004 pattern. No DML.

CREATE TABLE "Meeting" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "organizer" TEXT NOT NULL,
    "organizerId" TEXT,
    "attendeeIds" TEXT[],
    "scopeKind" TEXT,
    "scopeId" TEXT,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("tenantId","id")
);

CREATE INDEX "Meeting_tenantId_startAt_idx" ON "Meeting"("tenantId", "startAt");

ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Meeting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Meeting" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Meeting"
  USING ("tenantId" = current_setting('app.tenant_id', true));
