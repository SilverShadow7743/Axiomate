/**
 * Backfill ProjectMember from real history — the safety mechanism the design and plan both
 * name as the part of this rollout that cannot be gotten wrong.
 *
 * Run dry (the default) first: `npx tsx --conditions=react-server scripts/backfill-project-members.ts`
 * — prints exactly what would be written and nothing more, touches no data. Only once that
 * report has been read and judged safe: `... --commit` to actually write the rows.
 *
 * NEVER re-run `--commit` against a workspace that already holds membership rows. The rows are
 * numbered from an iteration counter and upserted by that id, so a second run rewrites the first
 * run's rows to whoever comes out in the same position today (found 2026-09-05, six rows in
 * production; ART-20260905-013, ADR 0004). `commitRefusal` in lib/backfillMembers.ts enforces
 * this until the correction routes the write through the reducer.
 *
 * Reuses `projectOf` — the same pure walk step 1 built and proved against `scopeChainOf` — so a
 * person's project is resolved identically here and in the live gate. Reimplementing that walk
 * as SQL would risk the two silently disagreeing, which is a worse failure than this script
 * being slow: a person backfilled onto the wrong project (or onto none) is invisible until
 * somebody notices they can't see their own work.
 *
 * Three real signal sources, not the four the design sketched. `Commitment` carries no project
 * reference at all — "not attached to a project, deliberately," per its own schema comment — and
 * `Sow` carries no person reference; both were named in the design before the real schema had
 * been read this closely. `createdBy`/`updatedBy` on a Sow are audit attribution, and this
 * program's standing rule is that audit `by` fields are never treated as identity data — using
 * one to seed access would be exactly that.
 */
import { config as loadEnv } from 'dotenv'
loadEnv()
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { loadWorkspace } from '../lib/db/repo'
import { projectOf } from '../lib/workspace'
import { projectMemberToRow } from '../lib/db/map'
import { currentTenantId } from '../lib/tenant'
import type { ProjectMember } from '../lib/staffing'
import { commitRefusal } from '../lib/backfillMembers'

const URL = process.env.DATABASE_URL
if (!URL) {
  console.log('DATABASE_URL is not set.')
  process.exit(1)
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: URL }) })
const COMMIT = process.argv.includes('--commit')

/** An org role's best-fit project-role badge. Correctable by hand afterwards, per the design. */
function defaultProjectRoleId(roleIds: string[]): string {
  if (roleIds.includes('ROLE_PROJECT_MANAGER')) return 'PROJROLE_PM'
  if (roleIds.includes('ROLE_ENGAGEMENT_LEAD')) return 'PROJROLE_ENGAGEMENT_MANAGER'
  return 'PROJROLE_CONSULTANT'
}

async function main() {
  const tenantId = currentTenantId()
  const { state } = await loadWorkspace(tenantId)
  const refusal = commitRefusal(Object.keys(state.projectMembers).length, COMMIT)
  if (refusal) {
    console.error(refusal)
    await prisma.$disconnect()
    process.exit(1)
  }
  const now = new Date().toISOString()

  const projects = Object.values(state.nodes).filter((n) => n.kind === 'project' && !n.deletedAt)
  console.log(`Tenant: ${tenantId}`)
  console.log(`Project nodes: ${projects.length}`)
  console.log('')

  // projectId -> personId -> earliest evidence date, for addedAt backdating
  const touched = new Map<string, Map<string, string>>()
  const touch = (projectId: string | null, personId: string | null | undefined, at: string) => {
    if (!projectId || !personId) return
    if (!touched.has(projectId)) touched.set(projectId, new Map())
    const byPerson = touched.get(projectId)!
    const existing = byPerson.get(personId)
    if (!existing || at < existing) byPerson.set(personId, at)
  }

  // Source 1: issue ownership. Unresolved owners (ownerId null) are reported, not silently
  // dropped — an owner the backfill cannot enrol is an owner about to lose sight of their own
  // work, which is exactly the failure this report exists to surface before it ships.
  const unresolvedOwners: { issueId: string; owner: string }[] = []
  for (const issue of Object.values(state.issues)) {
    if (issue.deletedAt) continue
    const projectId = projectOf(state, issue.id)
    if (!projectId) continue
    if (issue.owner && issue.owner !== 'Unassigned' && !issue.ownerId) {
      unresolvedOwners.push({ issueId: issue.id, owner: issue.owner })
    }
    touch(projectId, issue.ownerId, issue.lastActivity || issue.raised)
  }

  // Source 2: time entries.
  const unresolvedTimeEntries: { id: string; person: string }[] = []
  for (const entry of Object.values(state.timeEntries)) {
    const issue = state.issues[entry.issueId]
    if (!issue) continue
    const projectId = projectOf(state, issue.id)
    if (!projectId) continue
    if (!entry.personId) unresolvedTimeEntries.push({ id: entry.id, person: entry.person })
    touch(projectId, entry.personId, entry.date)
  }

  // Source 3: live allocations — already project-scoped, no walk needed.
  const unresolvedAllocations: { id: string; person: string }[] = []
  for (const alloc of Object.values(state.allocations)) {
    if (alloc.deletedAt) continue
    if (!state.nodes[alloc.projectId] || state.nodes[alloc.projectId].kind !== 'project') continue
    if (!alloc.personId) unresolvedAllocations.push({ id: alloc.id, person: alloc.person })
    touch(alloc.projectId, alloc.personId, alloc.startDate)
  }

  const members: ProjectMember[] = []
  let seq = 0
  for (const [projectId, byPerson] of touched) {
    for (const [personId, earliest] of byPerson) {
      const person = state.model.people[personId]
      if (!person) continue
      // ADMIN holders are exempt by role and need no row — see isExempt.
      if (person.roleIds.includes('ROLE_ADMIN')) continue
      seq += 1
      members.push({
        id: `projmem-backfill-${seq}`,
        projectId,
        person: person.name,
        personId,
        projectRoleId: defaultProjectRoleId(person.roleIds),
        addedBy: 'backfill migration 20260824000001',
        addedAt: earliest || now,
        removedAt: null,
      })
    }
  }

  console.log(`Would create ${members.length} membership row(s):`)
  const byProject = new Map<string, ProjectMember[]>()
  for (const m of members) {
    if (!byProject.has(m.projectId)) byProject.set(m.projectId, [])
    byProject.get(m.projectId)!.push(m)
  }
  for (const p of projects) {
    const ms = byProject.get(p.id) ?? []
    console.log(`  ${p.name} (${p.id}): ${ms.length} member(s)`)
    for (const m of ms) console.log(`    - ${m.person} — ${m.projectRoleId} (since ${m.addedAt.slice(0, 10)})`)
  }

  const problems = [...unresolvedOwners, ...unresolvedTimeEntries, ...unresolvedAllocations]
  if (unresolvedOwners.length) {
    console.log(`\nUNRESOLVED OWNERS (${unresolvedOwners.length}) — named on an issue under a project, but ownerId did not resolve. They will NOT be enrolled from this signal:`)
    for (const u of unresolvedOwners) console.log(`  ${u.issueId}: "${u.owner}"`)
  }
  if (unresolvedTimeEntries.length) {
    console.log(`\nUNRESOLVED TIME ENTRIES (${unresolvedTimeEntries.length}) — personId did not resolve:`)
    for (const u of unresolvedTimeEntries) console.log(`  ${u.id}: "${u.person}"`)
  }
  if (unresolvedAllocations.length) {
    console.log(`\nUNRESOLVED ALLOCATIONS (${unresolvedAllocations.length}) — personId did not resolve:`)
    for (const u of unresolvedAllocations) console.log(`  ${u.id}: "${u.person}"`)
  }

  console.log(
    problems.length
      ? `\n${problems.length} unresolved signal(s) above will not produce a membership row from that signal alone — check whether the same person is enrolled via a different signal before proceeding.`
      : '\nNo unresolved signals.',
  )

  if (!COMMIT) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit to apply.')
    await prisma.$disconnect()
    return
  }

  await prisma.$transaction(
    members.map((m) =>
      prisma.projectMember.upsert({
        where: { tenantId_id: { tenantId, id: m.id } },
        create: projectMemberToRow(tenantId, m),
        update: projectMemberToRow(tenantId, m),
      }),
    ),
  )
  console.log(`\nCommitted ${members.length} membership row(s).`)
  await prisma.$disconnect()
}

main()
