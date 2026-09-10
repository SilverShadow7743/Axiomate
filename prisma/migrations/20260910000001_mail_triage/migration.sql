-- Mail triage (docs/plans/2026-09-10-mail-triage-and-personal-actions-design.md): one additive
-- marker on Issue, set only by intake for a brand-new thread and cleared by any edit; and a
-- private personal action list, the PersonalEvent pattern applied to a to-do. New tables get
-- RLS in their own creation migration, per the discipline every table since 20260824000004 has
-- followed. Additive, no DML — an existing Issue reads as needsTriage = false, which is correct:
-- nothing already on the books was auto-filed under the new rule.

ALTER TABLE "Issue" ADD COLUMN "needsTriage" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "PersonalAction" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "dueDate" TEXT,
    "status" TEXT NOT NULL,
    "sourceSubject" TEXT,
    "sourceMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PersonalAction_pkey" PRIMARY KEY ("tenantId","id")
);

CREATE INDEX "PersonalAction_tenantId_personId_idx" ON "PersonalAction"("tenantId", "personId");

ALTER TABLE "PersonalAction" ADD CONSTRAINT "PersonalAction_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PersonalAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PersonalAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PersonalAction"
  USING ("tenantId" = current_setting('app.tenant_id', true));
