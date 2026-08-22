import 'dotenv/config'
import { prisma } from '../lib/db/client'
import { loadWorkspace } from '../lib/db/repo'
import { currentTenantId } from '../lib/tenant'

/**
 * One-shot backfill for the identity-id migration: fill the id half of every person
 * reference whose name resolves to exactly one directory entry.
 *
 * A DATA REPAIR, not a reducer replay — it writes only the new id column, so attested rows
 * stay byte-identical otherwise, and it GUESSES NOTHING: ambiguous names (two directory
 * entries) and unmatched names are reported, never resolved. Dry-run by default; pass
 * --apply to write.
 */

const APPLY = process.argv.includes('--apply')

type Table = {
  label: string
  nameCol: string
  idCol: string
  skip?: (name: string) => boolean
  rows: () => Promise<{ id: string; name: string }[]>
  write: (id: string, personId: string) => Promise<unknown>
}

async function main() {
  const tenantId = currentTenantId()
  const { state } = await loadWorkspace(tenantId)
  const people = Object.values(state.model.people)

  const byName = new Map<string, string[]>()
  for (const p of people) {
    const k = p.name.trim().toLowerCase()
    byName.set(k, [...(byName.get(k) ?? []), p.id])
  }
  const resolve = (name: string): string | 'ambiguous' | null => {
    const ids = byName.get(name.trim().toLowerCase())
    if (!ids || ids.length === 0) return null
    return ids.length === 1 ? ids[0] : 'ambiguous'
  }

  const where = { tenantId } as const
  const tables: Table[] = [
    {
      label: 'Issue.owner',
      nameCol: 'owner', idCol: 'ownerId',
      skip: (n) => !n.trim() || n.trim().toLowerCase() === 'unassigned',
      rows: async () => (await prisma.issue.findMany({ where: { ...where, ownerId: null }, select: { id: true, owner: true } })).map((r) => ({ id: r.id, name: r.owner })),
      write: (id, personId) => prisma.issue.update({ where: { tenantId_id: { tenantId, id } }, data: { ownerId: personId } }),
    },
    {
      label: 'TimeEntry.person',
      nameCol: 'person', idCol: 'personId',
      rows: async () => (await prisma.timeEntry.findMany({ where: { ...where, personId: null }, select: { id: true, person: true } })).map((r) => ({ id: r.id, name: r.person })),
      write: (id, personId) => prisma.timeEntry.update({ where: { tenantId_id: { tenantId, id } }, data: { personId } }),
    },
    {
      label: 'Timesheet.person',
      nameCol: 'person', idCol: 'personId',
      rows: async () => (await prisma.timesheet.findMany({ where: { ...where, personId: null }, select: { id: true, person: true } })).map((r) => ({ id: r.id, name: r.person })),
      write: (id, personId) => prisma.timesheet.update({ where: { tenantId_id: { tenantId, id } }, data: { personId } }),
    },
    {
      label: 'Allocation.person',
      nameCol: 'person', idCol: 'personId',
      rows: async () => (await prisma.allocation.findMany({ where: { ...where, personId: null }, select: { id: true, person: true } })).map((r) => ({ id: r.id, name: r.person })),
      write: (id, personId) => prisma.allocation.update({ where: { tenantId_id: { tenantId, id } }, data: { personId } }),
    },
    {
      label: 'Commitment.person',
      nameCol: 'person', idCol: 'personId',
      rows: async () => (await prisma.commitment.findMany({ where: { ...where, personId: null }, select: { id: true, person: true } })).map((r) => ({ id: r.id, name: r.person })),
      write: (id, personId) => prisma.commitment.update({ where: { tenantId_id: { tenantId, id } }, data: { personId } }),
    },
    {
      label: 'Notification.to',
      nameCol: 'to', idCol: 'toId',
      skip: (n) => n.trim().toLowerCase().startsWith('role:'),
      rows: async () => (await prisma.notification.findMany({ where: { ...where, toId: null }, select: { id: true, to: true } })).map((r) => ({ id: r.id, name: r.to })),
      write: (id, personId) => prisma.notification.update({ where: { tenantId_id: { tenantId, id } }, data: { toId: personId } }),
    },
  ]

  console.log(`Backfill person ids — tenant ${tenantId} — ${APPLY ? 'APPLY' : 'dry run'}`)
  console.log(`Directory: ${people.length} people, ${[...byName.values()].filter((v) => v.length > 1).length} name collisions\n`)

  let totalWritten = 0
  for (const t of tables) {
    const rows = await t.rows()
    let written = 0
    const ambiguous = new Set<string>()
    const unmatched = new Set<string>()
    let skipped = 0
    for (const r of rows) {
      if (t.skip?.(r.name)) { skipped++; continue }
      const hit = resolve(r.name)
      if (hit === 'ambiguous') ambiguous.add(r.name)
      else if (hit === null) unmatched.add(r.name)
      else {
        written++
        if (APPLY) await t.write(r.id, hit)
      }
    }
    totalWritten += written
    console.log(
      `${t.label.padEnd(20)} ${String(rows.length).padStart(5)} null-id rows · ${written} ${APPLY ? 'written' : 'would write'} · ${skipped} skipped · ${ambiguous.size} ambiguous · ${unmatched.size} unmatched`,
    )
    for (const n of ambiguous) console.log(`    AMBIGUOUS  ${JSON.stringify(n)}`)
    for (const n of unmatched) console.log(`    unmatched  ${JSON.stringify(n)}`)
  }
  console.log(`\n${APPLY ? 'Wrote' : 'Would write'} ${totalWritten} ids. Ambiguous and unmatched rows are left null — the name fallback keeps them joined as before.`)
}

main().then(
  () => process.exit(0),
  (e) => { console.error(e); process.exit(1) },
)
