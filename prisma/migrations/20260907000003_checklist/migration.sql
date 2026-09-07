-- Checklist items (docs/plans/2026-09-07-checklist-design.md): a lightweight to-do list within a
-- task. New tables get RLS in their own creation migration, per the discipline every table since
-- 20260824000004 has followed. No DML.

CREATE TABLE "ChecklistItem" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "sequence" INTEGER NOT NULL,
    "doneAt" TIMESTAMP(3),
    "doneBy" TEXT,
    "recordedBy" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("tenantId","id")
);

CREATE INDEX "ChecklistItem_tenantId_issueId_idx" ON "ChecklistItem"("tenantId", "issueId");

ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_tenantId_issueId_fkey"
  FOREIGN KEY ("tenantId", "issueId") REFERENCES "Issue"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChecklistItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChecklistItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ChecklistItem"
  USING ("tenantId" = current_setting('app.tenant_id', true));
