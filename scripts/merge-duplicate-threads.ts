/**
 * Cross-reference existing issues that are almost certainly the same email thread, filed more
 * than once — the shape the reply-threading bug left behind before it was fixed. See
 * `docs/plans/2026-08-25-intake-reply-threading-design.md`.
 *
 * ---------------------------------------------------------------------------
 * Why this links rather than merges
 *
 * Nothing is deleted, moved, or reassigned. Every issue in a group keeps its own notes, its own
 * time entries, its own status — this only adds a cross-reference, using `DUPLICATE_OF`, the same
 * relationship type the `duplicate` action's own reducer arm already mints when a person copies an
 * issue by hand. A person can act on the cross-reference (close the duplicates, consolidate by
 * hand) or ignore it; either way nothing here is destructive, and nothing here is hard to undo —
 * removing a wrong link costs one `unlink`.
 *
 * ---------------------------------------------------------------------------
 * Why this is not a live rule
 *
 * `duplicateGroups` (`lib/intake.ts`) matches on client + parent node + a subject with its
 * `Re:`/`Fw:`/`Fwd:` prefix stripped — exactly the signal the design document explicitly
 * warns against trusting for a live decision, because subjects get edited, translated and reused.
 * It is safe here only because a person reads the report before anything is linked, and because
 * linking is reversible. The live pipeline (`app/api/intake/route.ts`) matches on `conversationId`
 * alone, never subject, and this script does not change that.
 *
 *   npx tsx --conditions=react-server scripts/merge-duplicate-threads.ts                       # dry run
 *   npx tsx --conditions=react-server scripts/merge-duplicate-threads.ts --apply
 *
 * `--skip=ID,ID,...` names issues (canonical or duplicate, either works) whose whole group is
 * left out — for a group the dry-run report flagged as a real risk (a generic placeholder
 * subject, a gap too wide to be one thread) rather than a genuine duplicate. The skipped groups
 * still print, marked SKIPPED, so the report accounts for every group either way.
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { loadWorkspace } from '../lib/db/repo'
import { persistActions } from '../lib/db/persist'
import { duplicateGroups } from '../lib/intake'
import type { Action } from '../lib/workspace'
import type { TenantId } from '../lib/tenant'
import type { Actor } from '../lib/actor'

const APPLY = process.argv.includes('--apply')
const SKIP = new Set(
  (process.argv.find((a) => a.startsWith('--skip=')) ?? '').replace('--skip=', '').split(',').filter(Boolean),
)
const TENANT = (process.env.AXIOMATE_TENANT ?? 'axiocloud') as TenantId
const ACTOR: Actor = { id: 'merge-duplicate-threads', name: process.env.AXIOMATE_OPERATOR ?? 'Operator' }
const NOW = new Date().toISOString()

async function main() {
  const { state } = await loadWorkspace(TENANT)
  const groups = duplicateGroups(state.issues)

  console.log('AXIOMATE — MERGE DUPLICATE THREADS\n')

  if (groups.length === 0) {
    console.log('  No duplicate groups found.')
    return
  }

  console.log(`  ${groups.length} group(s) found:\n`)
  const actions: Action[] = []
  for (const g of groups) {
    const skipped = SKIP.has(g.canonical) || g.duplicates.some((id) => SKIP.has(id))
    const canonical = state.issues[g.canonical]
    console.log(`  ${g.canonical}  "${canonical.subject}"  (canonical, ${canonical.lastActivity})${skipped ? '  [SKIPPED]' : ''}`)
    for (const dupId of g.duplicates) {
      const dup = state.issues[dupId]
      console.log(`    -> ${dupId}  "${dup.subject}"  (${dup.lastActivity})`)
      if (skipped) continue
      actions.push({
        t: 'link',
        sourceIssueId: dupId,
        targetIssueId: g.canonical,
        relationshipType: 'DUPLICATE_OF',
        note: 'Linked by scripts/merge-duplicate-threads.ts — same email thread, filed more than once before reply threading was fixed.',
        now: NOW,
      })
    }
    console.log('')
  }

  if (!APPLY) {
    console.log(`  Dry run. ${actions.length} link(s) would be applied. Re-run with --apply.`)
    return
  }

  const result = await persistActions(TENANT, ACTOR, actions)
  console.log(result.ok ? `  Applied ${actions.length} link(s).` : `  REFUSED: ${result.error}`)
  if (!result.ok) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
