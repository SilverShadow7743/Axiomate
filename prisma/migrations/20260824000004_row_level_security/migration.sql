-- Row-level security.
--
-- Enables and FORCEs RLS on every tenant-scoped table (every model except Tenant itself,
-- which has no tenantId column to check), and adds one policy per table checking
-- "tenantId" = current_setting('app.tenant_id', true).
--
-- FORCE is required, not just ENABLE: the connecting role owns these tables (this app's own
-- migrations create them), and an owner bypasses RLS by default unless forced. See
-- docs/plans/2026-08-24-row-level-security-design.md.
--
-- app.tenant_id is set by exactly four places in the application, all committed in the
-- prior commit (lib/db/repo.ts's loadWorkspace and importWorkspace, lib/db/persist.ts's
-- runBatch, lib/db/schedule.ts) and proved live by scripts/rls-mechanism-proof.ts before
-- this migration was written. A connection that never sets it sees zero rows on every one
-- of these tables, not an error -- see docs/plans/2026-08-24-row-level-security-plan.md's
-- step 3 for why that is the highest-risk step in the whole plan.

ALTER TABLE "HierarchyNode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HierarchyNode" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "HierarchyNode"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "Issue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Issue" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Issue"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "IssueActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IssueActivity" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IssueActivity"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "IssueDependency" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IssueDependency" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IssueDependency"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "IssueRelationship" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IssueRelationship" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IssueRelationship"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "Evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Evidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Evidence"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "IssueNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IssueNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IssueNote"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "Engagement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Engagement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Engagement"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "OperatingModel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OperatingModel" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OperatingModel"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "WorkspaceMeta" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceMeta" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkspaceMeta"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "ScheduleWatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScheduleWatch" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ScheduleWatch"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "Allocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Allocation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Allocation"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "ProjectMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectMember" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProjectMember"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "PersonalEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PersonalEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PersonalEvent"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "InboundMail" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InboundMail" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InboundMail"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "Commitment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Commitment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Commitment"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "Sow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Sow" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Sow"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Notification"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "Approval" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Approval" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Approval"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "TimeEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimeEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TimeEntry"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "IssueEstimate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IssueEstimate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IssueEstimate"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "EstimateRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EstimateRevision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EstimateRevision"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "ScheduleAudit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScheduleAudit" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ScheduleAudit"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "AppliedAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppliedAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AppliedAction"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "Timesheet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Timesheet" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Timesheet"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "ChangeRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChangeRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ChangeRequest"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "PersonRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PersonRate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PersonRate"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "PersonSkill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PersonSkill" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PersonSkill"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Document" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Document"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "DocumentReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentReview" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DocumentReview"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "ScopeItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScopeItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ScopeItem"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "Milestone" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Milestone" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Milestone"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "Version" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Version" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Version"
  USING ("tenantId" = current_setting('app.tenant_id', true));
