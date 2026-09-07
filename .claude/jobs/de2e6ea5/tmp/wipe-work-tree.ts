/**
 * One-off: delete the work tree (issues and everything hung off them) for the axiocloud
 * tenant, per the user's explicit go-ahead. Leaves HierarchyNode, Sow, Milestone, ScopeItem,
 * ChangeRequest, the directory, rates, allocations, and OperatingModel untouched.
 *
 * A full CSV backup of every RLS-scoped table was taken first (see
 * ~/axiomate-tms-backup-20260902-003236/).
 *
 * Cascade (declared onDelete: Cascade in prisma/schema.prisma, so deleting Issue rows is
 * enough): IssueActivity, IssueDependency (via IssueActivity), IssueRelationship, Evidence,
 * IssueNote, TimeEntry, IssueEstimate, EstimateRevision (via IssueEstimate), Approval.
 *
 * NOT cascaded (loose string references, no FK) -- cleaned up explicitly here:
 * DiscussionThread/-Message/-Follow scoped to an issue, Document/DocumentReview scoped to an
 * issue. ChangeRequest.issueId is left dangling on purpose -- the schema's own comment
 * documents a null/stale issueId as a normal, already-tolerated state.
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { prisma, withTenant } from '../../../../lib/db/client'
import type { TenantId } from '../../../../lib/tenant'

const TENANT = 'axiocloud' as TenantId

async function main() {
  const before = await withTenant(TENANT, async (tx) => ({
    issue: await tx.issue.count(),
    hierarchyNode: await tx.hierarchyNode.count(),
    sow: await tx.sow.count(),
    milestone: await tx.milestone.count(),
    discussionThreadIssue: await tx.discussionThread.count({ where: { scopeKind: 'issue' } }),
    documentIssue: await tx.document.count({ where: { subjectKind: 'issue' } }),
    documentReview: await tx.documentReview.count(),
    timeEntry: await tx.timeEntry.count(),
    issueActivity: await tx.issueActivity.count(),
    issueEstimate: await tx.issueEstimate.count(),
    issueNote: await tx.issueNote.count(),
    issueRelationship: await tx.issueRelationship.count(),
    approval: await tx.approval.count(),
  }))
  console.log('BEFORE', before)

  const result = await withTenant(TENANT, async (tx) => {
    const issueThreads = await tx.discussionThread.findMany({
      where: { scopeKind: 'issue' },
      select: { id: true },
    })
    const threadIds = issueThreads.map((t) => t.id)

    const follows = await tx.discussionFollow.deleteMany({ where: { threadId: { in: threadIds } } })
    const messages = await tx.discussionMessage.deleteMany({ where: { threadId: { in: threadIds } } })
    const threads = await tx.discussionThread.deleteMany({ where: { scopeKind: 'issue' } })

    const docs = await tx.document.deleteMany({ where: { subjectKind: 'issue' } })
    // DocumentReview.issueId has no FK -- match against the live issue id set before it's gone.
    const issueIds = (await tx.issue.findMany({ select: { id: true } })).map((i) => i.id)
    const reviews = await tx.documentReview.deleteMany({ where: { issueId: { in: issueIds } } })

    const issues = await tx.issue.deleteMany({})

    return { follows, messages, threads, docs, reviews, issues }
  })
  console.log('DELETED', {
    discussionFollow: result.follows.count,
    discussionMessage: result.messages.count,
    discussionThread: result.threads.count,
    document: result.docs.count,
    documentReview: result.reviews.count,
    issue: result.issues.count,
  })

  const after = await withTenant(TENANT, async (tx) => ({
    issue: await tx.issue.count(),
    hierarchyNode: await tx.hierarchyNode.count(),
    sow: await tx.sow.count(),
    milestone: await tx.milestone.count(),
    discussionThreadIssue: await tx.discussionThread.count({ where: { scopeKind: 'issue' } }),
    documentIssue: await tx.document.count({ where: { subjectKind: 'issue' } }),
    documentReview: await tx.documentReview.count(),
    timeEntry: await tx.timeEntry.count(),
    issueActivity: await tx.issueActivity.count(),
    issueEstimate: await tx.issueEstimate.count(),
    issueNote: await tx.issueNote.count(),
    issueRelationship: await tx.issueRelationship.count(),
    approval: await tx.approval.count(),
  }))
  console.log('AFTER', after)

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
