-- HierarchyNode.sowId is a foreign key (the "SowDelivery" relation to Sow) with no index --
-- Postgres does not index foreign key columns automatically. Two costs follow: a query
-- filtering or joining on a project's SOW does a sequential scan, and every DELETE/archive of a
-- Sow row pays a full table scan of HierarchyNode to enforce the onDelete: Restrict constraint
-- (Postgres must find every referencing row before it can refuse the delete).
--
-- Purely additive and needs no expand/contract sequencing (docs/adr/0005-expand-contract-
-- migrations.md): nothing currently deployed has to change for an index to exist, and nothing
-- currently deployed is affected by it existing. A plain CREATE INDEX, not CONCURRENTLY -- this
-- repository's migrations run inside prisma migrate deploy's own transaction per file, which
-- CONCURRENTLY cannot do, and HierarchyNode's per-tenant size does not warrant the added
-- complexity of a non-transactional migration this codebase has no other precedent for.

CREATE INDEX "HierarchyNode_tenantId_sowId_idx" ON "HierarchyNode"("tenantId", "sowId");
