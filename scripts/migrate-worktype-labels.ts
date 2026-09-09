/**
 * I21 — rewrite issues whose `type` holds a raw work-type code instead of its label.
 *
 * Dry-run by default; `--apply` to run. Tenant from AXIOMATE_TENANT (default axiocloud).
 *
 * See docs/plans/2026-09-08-work-type-data-cleanup-design.md — Option A, chosen over leaving
 * history as imported. Nine `WorkType` entries were minted by `lib/config.ts`'s type-discovery
 * loop from source data that already held a raw code (`"WT_EPIC"`) rather than a human label
 * ("Epic"), producing a duplicate registry entry (`id: WT_WT_EPIC, label: "WT_EPIC"`) alongside
 * the clean one (`id: WT_EPIC, label: "Epic"`) — and 134 issues whose `type` was left holding
 * that raw code.
 *
 * The fix needs no hardcoded list of the nine pairs: a raw code and the clean entry's id are the
 * same string by construction (`workTypeId("Epic")` produces `"WT_EPIC"`, the exact code the
 * source data already used). So this looks up `state.model.workTypes[issue.type]` for every
 * issue — if that succeeds and the found entry's own `label` differs from `issue.type`, the
 * issue is storing an id-shaped value where a label belongs, and gets corrected to that entry's
 * `label`. Anything already holding a real label (the entry's `label === issue.type`) resolves
 * to itself and is left untouched, so the script is safe to re-run.
 *
 * Through `persistActions` (`updateIssue`), not SQL, for the same reason the module-container
 * conversion used it: 134 ordinary, attributable edits, not a silent rewrite.
 */
import 'dotenv/config'
import { loadWorkspace } from '../lib/db/repo'
import { persistActions } from '../lib/db/persist'
import type { Action } from '../lib/workspace'
import type { Actor } from '../lib/actor'
import type { TenantId } from '../lib/tenant'

const APPLY = process.argv.includes('--apply')
const TENANT = (process.env.AXIOMATE_TENANT ?? 'axiocloud') as TenantId
const ACTOR: Actor = { id: 'worktype-label-migration', name: process.env.AXIOMATE_OPERATOR ?? 'Operator' }
const NOW = new Date().toISOString()

async function main() {
  const { state } = await loadWorkspace(TENANT)

  const fixes: { issueId: string; from: string; to: string }[] = []
  for (const i of Object.values(state.issues)) {
    if (i.deletedAt) continue
    const entry = state.model.workTypes[i.type]
    if (!entry || entry.label === i.type) continue
    fixes.push({ issueId: i.id, from: i.type, to: entry.label })
  }

  console.log(`${TENANT}: ${fixes.length} issue(s) with an id-shaped type to correct.`)
  const byPair = new Map<string, number>()
  for (const f of fixes) {
    const key = `${f.from} -> ${f.to}`
    byPair.set(key, (byPair.get(key) ?? 0) + 1)
  }
  for (const [pair, count] of [...byPair.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pair}: ${count}`)
  }

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply.')
    return
  }
  if (!fixes.length) {
    console.log('\nNothing to apply.')
    return
  }

  const actions: Action[] = fixes.map(
    (f) => ({ t: 'updateIssue', id: f.issueId, patch: { type: f.to }, now: NOW }) as Action,
  )
  for (let at = 0; at < actions.length; at += 50) {
    const slice = actions.slice(at, at + 50)
    const r = await persistActions(TENANT, ACTOR, slice)
    if (!r.ok) {
      console.error(`\nBatch starting at ${at} refused: ${r.error}`)
      console.error('Everything before this batch has applied; nothing after it has. Re-run resumes safely — already-corrected issues resolve to themselves and are skipped.')
      process.exit(1)
    }
    console.log(`  applied ${at + slice.length}/${actions.length}`)
  }

  /* ---- verify ---- */
  const after = (await loadWorkspace(TENANT)).state
  const remaining = Object.values(after.issues).filter((i) => {
    if (i.deletedAt) return false
    const entry = after.model.workTypes[i.type]
    return entry && entry.label !== i.type
  })
  console.log(`\nAfter: ${remaining.length} issue(s) still id-shaped (want 0).`)
  if (remaining.length) process.exit(1)
}

await main()
