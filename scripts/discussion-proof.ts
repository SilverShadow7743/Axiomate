/**
 * Does the Discussion domain hold — storage, gates, mints, isolation?
 *
 * Run with `npm run audit:discussion`, against a real database.
 *
 * This domain deliberately bypasses the reducer and `persistSteps` (its rows never enter
 * `WorkspaceState`), so nothing in the scenario suite or the persistence proof can vouch for
 * it. The E2 lesson — an arm whose rows the writer drops persists NOTHING, and no gate
 * notices — is why this proof lands in the same commit as `lib/db/discussion.ts` and covers
 * every behaviour the design names: the race-safe lazy thread, attribution, auto-follows,
 * follow round-trips, own-only removal, the internal.view refusal, the mint through the
 * ordinary notify funnel (prefs, mute-audit and all), and cross-tenant RLS isolation.
 *
 * Its own tenants; both removed at the end.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
loadEnv()

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { importWorkspace, loadWorkspace } from '../lib/db/repo'
import { withTenant } from '../lib/db/client'
import { persistActions } from '../lib/db/persist'
import { listThread, postMessage, removeOwn, setFollow } from '../lib/db/discussion'
import { initWorkspace, type Action, type SeedIssueInput } from '../lib/workspace'
import type { Actor } from '../lib/actor'
import type { TenantId } from '../lib/tenant'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const URL = process.env.DATABASE_URL
if (!URL) {
  console.log('DATABASE_URL is not set. This proof needs a database — see .env.example.')
  process.exit(1)
}

const TENANT = 'proof-discussion' as TenantId
const TENANT_B = 'proof-discussion-b' as TenantId
const A: Actor = { id: 'disc-proof', name: 'Discussion Proof' } // unknown → default role
const PRIYA: Actor = { id: 'disc-priya', name: 'Priya' }
const SAM: Actor = { id: 'disc-sam', name: 'Sam' }
const NOW = new Date().toISOString()

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: URL }) })

const fail: string[] = []
const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ' — ' + detail : ''}`)
  results.push({ what, ok, detail })
  if (!ok) fail.push(what)
}

const seedIssue = (id: string, over: Partial<SeedIssueInput> = {}): SeedIssueInput =>
  ({
    id, client: 'DPROOF', engagement: 'Discussion Proof Engagement', module: 'Inventory',
    subject: `Subject ${id}`, description: '', type: 'Defect', severity: 'High',
    status: 'Open', owner: 'Priya', raisedBy: 'Client', accountable: 'DPROOF',
    raised: '2026-08-03', lastActivity: '2026-08-03', actualEnd: null, age: 1,
    daysSinceActivity: 1, nextAction: '', evidence: '', evidenceDate: '',
    verification: '', source: 'Proof', reference: '', clientImpact: '',
    ...over,
  }) as SeedIssueInput

/** The persistence proof's ordering, trimmed to what these tenants can own. */
async function scrub(tenantId: TenantId) {
  await withTenant(tenantId, async (tx) => {
    const where = { tenantId }
    await tx.discussionFollow.deleteMany({ where })
    await tx.discussionMessage.deleteMany({ where })
    await tx.discussionThread.deleteMany({ where })
    await tx.notification.deleteMany({ where })
    await tx.scheduleAudit.deleteMany({ where })
    await tx.appliedAction.deleteMany({ where })
    await tx.issueActivity.deleteMany({ where })
    await tx.issueNote.deleteMany({ where })
    await tx.issue.deleteMany({ where })
    await tx.hierarchyNode.updateMany({ where, data: { parentId: null } })
    await tx.hierarchyNode.deleteMany({ where })
    await tx.workspaceMeta.deleteMany({ where })
    await tx.operatingModel.deleteMany({ where })
  })
  await prisma.tenant.deleteMany({ where: { id: tenantId } })
}

async function main() {
  console.log('--- Discussion proof (the domain that bypasses persistSteps) ---\n')

  await scrub(TENANT).catch(() => {})
  await scrub(TENANT_B).catch(() => {})
  await importWorkspace(TENANT, initWorkspace([seedIssue('DISC-1'), seedIssue('DISC-2', { owner: 'Sam' })], []))
  await importWorkspace(TENANT_B, initWorkspace([seedIssue('DISC-1')], []))

  /* 1. The first post births the thread; attribution is the actor's; the owner-author
        follows once. */
  const p1 = await postMessage(TENANT, PRIYA, 'issue', 'DISC-1', 'Kicking this off.', 'Priya')
  const v1 = await listThread(TENANT, PRIYA, 'issue', 'DISC-1')
  const ok1 = !('error' in p1) && !('error' in v1) && v1.thread !== null && v1.messages.length === 1
  check(
    'a first post creates the thread and the message, attributed to the actor',
    ok1 && !('error' in p1) && p1.message.author === 'Priya' && p1.message.authorId !== null,
    'error' in p1 ? p1.error : `author=${p1.message.author} authorId=${p1.message.authorId}`,
  )
  check(
    'the author-owner follows once, not twice',
    !('error' in v1) && v1.following && v1.followerCount === 1,
    'error' in v1 ? v1.error : `following=${v1.following} count=${v1.followerCount}`,
  )

  /* 2. A second post appends — no second thread — and mints through the ordinary funnel:
        chat to the follower, mention to the summoned, one record each. */
  const p2 = await postMessage(TENANT, A, 'issue', 'DISC-1', 'On it — @Sam should see this too.')
  const st2 = (await loadWorkspace(TENANT)).state
  const minted = Object.values(st2.notifications).filter((n) => n.ruleId === 'discussion-message')
  const priyaId = Object.values(st2.model.people).find((p) => p.name === 'Priya')?.id
  const samId = Object.values(st2.model.people).find((p) => p.name === 'Sam')?.id
  const chatRec = minted.find((n) => n.toId === priyaId)
  const mentionRec = minted.find((n) => n.toId === samId)
  check(
    'the second post appends to the one thread',
    !('error' in p2) &&
      (await withTenant(TENANT, (tx) => tx.discussionThread.count({ where: { tenantId: TENANT } }))) === 1,
  )
  check(
    'the follower hears under chat, the mentioned under mention — one record each',
    minted.length === 2 &&
      Boolean(chatRec && /discussion you follow/.test(chatRec.body)) &&
      Boolean(mentionRec && /mentioned you/.test(mentionRec.subject)),
    minted.map((n) => `${n.to}:${n.subject}`).join(' | '),
  )

  /* 3. A muted follower is silent, and the audit still answers why. */
  await persistActions(TENANT, A, [
    { t: 'setNotificationPref', personId: priyaId, kind: 'chat', mode: 'mute', now: NOW } as Action,
  ])
  await postMessage(TENANT, A, 'issue', 'DISC-1', 'Quiet update.')
  const st3 = (await loadWorkspace(TENANT)).state
  const after = Object.values(st3.notifications).filter((n) => n.ruleId === 'discussion-message')
  check(
    'a muted follower gets no record, and the audit line says why',
    after.length === 2 && st3.audit.some((e) => e.field === 'notification' && /muted by their preference/.test(e.to ?? '')),
    `records=${after.length}`,
  )

  /* 4. Follow round-trips, and unfollow means unfollow. */
  const f1 = await setFollow(TENANT, SAM, 'issue', 'DISC-1', true)
  const v2 = await listThread(TENANT, SAM, 'issue', 'DISC-1')
  const f2 = await setFollow(TENANT, SAM, 'issue', 'DISC-1', false)
  const v3 = await listThread(TENANT, SAM, 'issue', 'DISC-1')
  check(
    'follow and unfollow round-trip through Postgres',
    !('error' in f1) && !('error' in v2) && v2.following && !('error' in f2) && !('error' in v3) && !v3.following,
  )

  /* 5. Removal is the author's alone, and soft. */
  const firstMsg = !('error' in v1) ? v1.messages[0] : undefined
  const wrong = await removeOwn(TENANT, SAM, firstMsg?.id ?? '')
  const right = await removeOwn(TENANT, PRIYA, firstMsg?.id ?? '')
  const v4 = await listThread(TENANT, PRIYA, 'issue', 'DISC-1')
  check(
    "removing another's message is refused in words; removing your own leaves a stub",
    'error' in wrong && /who said it/.test(wrong.error) && !('error' in right) &&
      !('error' in v4) && v4.messages.some((m) => m.id === firstMsg?.id && m.deletedAt !== null),
    'error' in wrong ? wrong.error : '',
  )

  /* 6. Two first-posts race: the unique index decides, the loser appends — one thread. */
  const [r1, r2] = await Promise.all([
    postMessage(TENANT, PRIYA, 'project', 'node:dproof-project', 'first?'),
    postMessage(TENANT, SAM, 'project', 'node:dproof-project', 'or first?'),
  ])
  const projThreads = await withTenant(TENANT, (tx) =>
    tx.discussionThread.count({ where: { tenantId: TENANT, scopeKind: 'project' } }),
  )
  const projMsgs = await withTenant(TENANT, (tx) =>
    tx.discussionMessage.count({ where: { tenantId: TENANT } }),
  )
  check(
    'two concurrent first posts land on ONE thread, both kept',
    !('error' in r1) && !('error' in r2) && projThreads === 1,
    `threads=${projThreads} messages(all)=${projMsgs}`,
  )

  /* 7. internal.view gates reading and posting. */
  await persistActions(TENANT, A, [
    { t: 'config', op: { k: 'upsertPerson', id: null, name: 'Proof Client', roleIds: ['ROLE_CLIENT_USER'] }, now: NOW } as Action,
  ])
  const CLIENT: Actor = { id: 'disc-client', name: 'Proof Client' }
  const cRead = await listThread(TENANT, CLIENT, 'issue', 'DISC-1')
  const cPost = await postMessage(TENANT, CLIENT, 'issue', 'DISC-1', 'hello?')
  check(
    'a reader without internal.view is refused, reading and posting alike',
    'error' in cRead && 'error' in cPost,
    'error' in cRead ? cRead.error : 'read allowed',
  )

  /* 8. Cross-tenant isolation: the same scope id in the other tenant holds nothing. */
  const bView = await listThread(TENANT_B, A, 'issue', 'DISC-1')
  const bCount = await withTenant(TENANT_B, (tx) =>
    tx.discussionThread.count({ where: { tenantId: TENANT_B } }),
  )
  check(
    "the other tenant sees no thread on the same scope id — RLS plus explicit scoping",
    !('error' in bView) && bView.thread === null && bCount === 0,
    `count=${bCount}`,
  )

  /* ---------------- record the run, scrub, verdict ---------------- */
  fs.writeFileSync(
    path.join(ROOT, 'data', 'discussion.json'),
    JSON.stringify({ asAt: NOW, checks: results }, null, 2) + '\n',
  )
  await scrub(TENANT)
  await scrub(TENANT_B)
  const gone =
    (await prisma.tenant.count({ where: { id: { in: [TENANT, TENANT_B] } } })) === 0
  check('both proof tenants scrub to nothing', gone)

  console.log(
    fail.length
      ? `\nFAIL: ${fail.join(' | ')}`
      : `\nDiscussion: ${results.length} checks — the domain that bypasses persistSteps has its own net.`,
  )
  process.exit(fail.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
