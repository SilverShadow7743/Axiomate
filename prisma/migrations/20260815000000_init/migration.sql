-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "NodeKind" AS ENUM ('COMPANY', 'CLIENT', 'ENGAGEMENT', 'PROJECT', 'MODULE');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "ScheduleMode" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('FS', 'SS', 'FF', 'SF');

-- CreateEnum
CREATE TYPE "ActivityOrigin" AS ENUM ('GENERATED', 'USER');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('SNAPSHOT', 'DATA', 'DOCUMENT', 'LINK');

-- CreateEnum
CREATE TYPE "EvidenceOrigin" AS ENUM ('IMPORTED', 'USER');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HierarchyNode" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "kind" "NodeKind" NOT NULL,
    "name" TEXT NOT NULL,
    "owner" TEXT,
    "parentId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HierarchyNode_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "Issue" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "nodeId" TEXT,
    "parentIssueId" TEXT,
    "client" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT '',
    "severity" "Severity" NOT NULL,
    "status" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "raisedBy" TEXT NOT NULL,
    "accountable" TEXT NOT NULL,
    "scheduleMode" "ScheduleMode" NOT NULL DEFAULT 'AUTO',
    "plannedStartDate" TIMESTAMP(3),
    "plannedEndDate" TIMESTAMP(3),
    "percentOverride" INTEGER,
    "raisedDate" TIMESTAMP(3) NOT NULL,
    "lastActivityDate" TIMESTAMP(3) NOT NULL,
    "actualEndDate" TIMESTAMP(3),
    "age" INTEGER NOT NULL DEFAULT 0,
    "daysSinceActivity" INTEGER NOT NULL DEFAULT 0,
    "nextAction" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "evidenceDate" TIMESTAMP(3),
    "verification" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "clientImpact" TEXT NOT NULL,
    "assignments" JSONB NOT NULL DEFAULT '{}',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "IssueActivity" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "scheduleMode" "ScheduleMode" NOT NULL DEFAULT 'MANUAL',
    "plannedStartDate" TIMESTAMP(3) NOT NULL,
    "plannedEndDate" TIMESTAMP(3) NOT NULL,
    "percentComplete" INTEGER NOT NULL DEFAULT 0,
    "isMilestone" BOOLEAN NOT NULL DEFAULT false,
    "origin" "ActivityOrigin" NOT NULL DEFAULT 'USER',
    "owner" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueActivity_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "IssueDependency" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,
    "successorId" TEXT NOT NULL,
    "dependencyType" "DependencyType" NOT NULL DEFAULT 'FS',
    "lagDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "IssueDependency_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "IssueRelationship" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "sourceIssueId" TEXT NOT NULL,
    "targetIssueId" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',

    CONSTRAINT "IssueRelationship_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT,
    "url" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "note" TEXT NOT NULL,
    "origin" "EvidenceOrigin" NOT NULL DEFAULT 'USER',
    "addedAt" TIMESTAMP(3) NOT NULL,
    "addedBy" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "IssueNote" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "noteType" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "IssueNote_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "Engagement" (
    "tenantId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "engagementLeader" TEXT NOT NULL DEFAULT '',
    "projectManager" TEXT NOT NULL DEFAULT '',
    "clientSponsor" TEXT NOT NULL DEFAULT '',
    "sowReference" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Engagement_pkey" PRIMARY KEY ("tenantId","nodeId")
);

-- CreateTable
CREATE TABLE "OperatingModel" (
    "tenantId" TEXT NOT NULL,
    "model" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatingModel_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "WorkspaceMeta" (
    "tenantId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 1,
    "seededAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceMeta_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "ScheduleAudit" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "from" TEXT,
    "to" TEXT,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by" TEXT NOT NULL,

    CONSTRAINT "ScheduleAudit_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateIndex
CREATE INDEX "HierarchyNode_tenantId_parentId_idx" ON "HierarchyNode"("tenantId", "parentId");

-- CreateIndex
CREATE INDEX "HierarchyNode_tenantId_deletedAt_idx" ON "HierarchyNode"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "Issue_tenantId_nodeId_idx" ON "Issue"("tenantId", "nodeId");

-- CreateIndex
CREATE INDEX "Issue_tenantId_parentIssueId_idx" ON "Issue"("tenantId", "parentIssueId");

-- CreateIndex
CREATE INDEX "Issue_tenantId_client_module_idx" ON "Issue"("tenantId", "client", "module");

-- CreateIndex
CREATE INDEX "Issue_tenantId_status_idx" ON "Issue"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Issue_tenantId_deletedAt_idx" ON "Issue"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "IssueActivity_tenantId_issueId_order_idx" ON "IssueActivity"("tenantId", "issueId", "order");

-- CreateIndex
CREATE INDEX "IssueActivity_tenantId_deletedAt_idx" ON "IssueActivity"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "IssueDependency_tenantId_successorId_idx" ON "IssueDependency"("tenantId", "successorId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueDependency_tenantId_predecessorId_successorId_key" ON "IssueDependency"("tenantId", "predecessorId", "successorId");

-- CreateIndex
CREATE INDEX "IssueRelationship_tenantId_targetIssueId_idx" ON "IssueRelationship"("tenantId", "targetIssueId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueRelationship_tenantId_sourceIssueId_targetIssueId_rela_key" ON "IssueRelationship"("tenantId", "sourceIssueId", "targetIssueId", "relationshipType");

-- CreateIndex
CREATE INDEX "Evidence_tenantId_issueId_kind_idx" ON "Evidence"("tenantId", "issueId", "kind");

-- CreateIndex
CREATE INDEX "Evidence_tenantId_deletedAt_idx" ON "Evidence"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "IssueNote_tenantId_issueId_idx" ON "IssueNote"("tenantId", "issueId");

-- CreateIndex
CREATE INDEX "IssueNote_tenantId_deletedAt_idx" ON "IssueNote"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "Engagement_tenantId_client_idx" ON "Engagement"("tenantId", "client");

-- CreateIndex
CREATE INDEX "ScheduleAudit_tenantId_rowId_at_idx" ON "ScheduleAudit"("tenantId", "rowId", "at");

-- CreateIndex
CREATE INDEX "ScheduleAudit_tenantId_at_idx" ON "ScheduleAudit"("tenantId", "at");

-- AddForeignKey
ALTER TABLE "HierarchyNode" ADD CONSTRAINT "HierarchyNode_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HierarchyNode" ADD CONSTRAINT "HierarchyNode_tenantId_parentId_fkey" FOREIGN KEY ("tenantId", "parentId") REFERENCES "HierarchyNode"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_tenantId_nodeId_fkey" FOREIGN KEY ("tenantId", "nodeId") REFERENCES "HierarchyNode"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_tenantId_parentIssueId_fkey" FOREIGN KEY ("tenantId", "parentIssueId") REFERENCES "Issue"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueActivity" ADD CONSTRAINT "IssueActivity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueActivity" ADD CONSTRAINT "IssueActivity_tenantId_issueId_fkey" FOREIGN KEY ("tenantId", "issueId") REFERENCES "Issue"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueDependency" ADD CONSTRAINT "IssueDependency_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueDependency" ADD CONSTRAINT "IssueDependency_tenantId_predecessorId_fkey" FOREIGN KEY ("tenantId", "predecessorId") REFERENCES "IssueActivity"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueDependency" ADD CONSTRAINT "IssueDependency_tenantId_successorId_fkey" FOREIGN KEY ("tenantId", "successorId") REFERENCES "IssueActivity"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueRelationship" ADD CONSTRAINT "IssueRelationship_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueRelationship" ADD CONSTRAINT "IssueRelationship_tenantId_sourceIssueId_fkey" FOREIGN KEY ("tenantId", "sourceIssueId") REFERENCES "Issue"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueRelationship" ADD CONSTRAINT "IssueRelationship_tenantId_targetIssueId_fkey" FOREIGN KEY ("tenantId", "targetIssueId") REFERENCES "Issue"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_tenantId_issueId_fkey" FOREIGN KEY ("tenantId", "issueId") REFERENCES "Issue"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueNote" ADD CONSTRAINT "IssueNote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueNote" ADD CONSTRAINT "IssueNote_tenantId_issueId_fkey" FOREIGN KEY ("tenantId", "issueId") REFERENCES "Issue"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_tenantId_nodeId_fkey" FOREIGN KEY ("tenantId", "nodeId") REFERENCES "HierarchyNode"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatingModel" ADD CONSTRAINT "OperatingModel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMeta" ADD CONSTRAINT "WorkspaceMeta_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleAudit" ADD CONSTRAINT "ScheduleAudit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
