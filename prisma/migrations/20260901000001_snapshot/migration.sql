-- Snapshot: a point-in-time copy of a project or engagement's planned dates and cost. Same
-- shape as Meeting (20260830000004) — forced RLS, the 20260824000004 pattern. No DML.

CREATE TABLE "Snapshot" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeKind" TEXT NOT NULL,
    "nodeName" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "takenBy" TEXT NOT NULL,
    "entries" JSONB NOT NULL,
    "cost" JSONB,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("tenantId","id")
);

CREATE INDEX "Snapshot_tenantId_nodeId_idx" ON "Snapshot"("tenantId", "nodeId");

ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Snapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Snapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Snapshot"
  USING ("tenantId" = current_setting('app.tenant_id', true));
