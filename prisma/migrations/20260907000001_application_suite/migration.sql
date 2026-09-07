-- Application Suite (docs/plans/2026-09-07-application-suite-design.md): a client's own
-- technology landscape, and how it connects. New tables get RLS in their own creation
-- migration, per the discipline every table since 20260824000004 has followed. No DML.

CREATE TABLE "Application" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "clientNodeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT '',
    "environment" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "goLiveDate" TIMESTAMP(3),
    "owner" TEXT NOT NULL DEFAULT '',
    "ownerId" TEXT,
    "vendor" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Application_pkey" PRIMARY KEY ("tenantId","id")
);

CREATE TABLE "IntegrationLink" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "sourceApplicationId" TEXT NOT NULL,
    "targetApplicationId" TEXT NOT NULL,
    "interface" TEXT NOT NULL DEFAULT '',
    "businessProcess" TEXT NOT NULL DEFAULT '',
    "frequency" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "recordedBy" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationLink_pkey" PRIMARY KEY ("tenantId","id")
);

CREATE INDEX "Application_tenantId_clientNodeId_idx" ON "Application"("tenantId", "clientNodeId");
CREATE INDEX "Application_tenantId_deletedAt_idx" ON "Application"("tenantId", "deletedAt");

CREATE INDEX "IntegrationLink_tenantId_sourceApplicationId_idx" ON "IntegrationLink"("tenantId", "sourceApplicationId");
CREATE INDEX "IntegrationLink_tenantId_targetApplicationId_idx" ON "IntegrationLink"("tenantId", "targetApplicationId");

ALTER TABLE "Application" ADD CONSTRAINT "Application_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Application" ADD CONSTRAINT "Application_tenantId_clientNodeId_fkey"
  FOREIGN KEY ("tenantId", "clientNodeId") REFERENCES "HierarchyNode"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IntegrationLink" ADD CONSTRAINT "IntegrationLink_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IntegrationLink" ADD CONSTRAINT "IntegrationLink_tenantId_sourceApplicationId_fkey"
  FOREIGN KEY ("tenantId", "sourceApplicationId") REFERENCES "Application"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntegrationLink" ADD CONSTRAINT "IntegrationLink_tenantId_targetApplicationId_fkey"
  FOREIGN KEY ("tenantId", "targetApplicationId") REFERENCES "Application"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Application" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Application" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Application"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "IntegrationLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationLink" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IntegrationLink"
  USING ("tenantId" = current_setting('app.tenant_id', true));

-- Issue gains an optional, additive link to a real Application. `module` (free text, 21 values
-- in the live register today) is untouched — see the design doc's own note on why this is
-- additive rather than a migration of existing data.
ALTER TABLE "Issue" ADD COLUMN "applicationId" TEXT;
CREATE INDEX "Issue_tenantId_applicationId_idx" ON "Issue"("tenantId", "applicationId");
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_tenantId_applicationId_fkey"
  FOREIGN KEY ("tenantId", "applicationId") REFERENCES "Application"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
