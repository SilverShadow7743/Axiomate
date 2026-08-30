-- The Discussion domain (E3): one thread per scope, its messages, and who follows it.
-- Server-queried from day one — these rows never ride the boot payload — and tenant-isolated
-- by the same forced RLS policy as every other tenant-scoped table (20260824000004's pattern:
-- FORCE is required because the connecting role owns the tables and an owner bypasses
-- ENABLE'd RLS). No DML.

CREATE TABLE "DiscussionThread" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "scopeKind" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "DiscussionThread_pkey" PRIMARY KEY ("tenantId","id")
);

CREATE TABLE "DiscussionMessage" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DiscussionMessage_pkey" PRIMARY KEY ("tenantId","id")
);

CREATE TABLE "DiscussionFollow" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscussionFollow_pkey" PRIMARY KEY ("tenantId","id")
);

-- One live thread per scope: the DB enforces it; check-then-insert races (two first posts).
CREATE UNIQUE INDEX "DiscussionThread_tenantId_scopeKind_scopeId_key"
  ON "DiscussionThread"("tenantId", "scopeKind", "scopeId");

CREATE INDEX "DiscussionMessage_tenantId_threadId_createdAt_idx"
  ON "DiscussionMessage"("tenantId", "threadId", "createdAt");

CREATE UNIQUE INDEX "DiscussionFollow_tenantId_threadId_personId_key"
  ON "DiscussionFollow"("tenantId", "threadId", "personId");

ALTER TABLE "DiscussionThread" ADD CONSTRAINT "DiscussionThread_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscussionMessage" ADD CONSTRAINT "DiscussionMessage_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscussionFollow" ADD CONSTRAINT "DiscussionFollow_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DiscussionThread" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscussionThread" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DiscussionThread"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "DiscussionMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscussionMessage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DiscussionMessage"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "DiscussionFollow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscussionFollow" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DiscussionFollow"
  USING ("tenantId" = current_setting('app.tenant_id', true));
