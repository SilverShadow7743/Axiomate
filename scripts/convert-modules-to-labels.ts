/**
 * E0 step 8b — convert one tenant's Process Area containers to labels.
 *
 * Dry-run by default; `--apply` to run. Tenant from AXIOMATE_TENANT (default axiocloud).
 *
 * Three phases, in an order that never leaves intake broken:
 *   1. Every enabled mailbox or intake form whose scope is a live module node is retargeted
 *      to that module's parent, with the module's name stamped as the mailbox's
 *      `classification` — so what files there keeps classifying exactly as the container
 *      used to classify it (see IntakeMailbox.classification).
 *   2. Every live issue parented on a module node moves to the module's parent, through the
 *      reducer's own `move` arm — audited, validated, and label-preserving: the move arm only
 *      rewrites `module` when it finds a module ancestor on the NEW chain, and there is none.
 *   3. The emptied module containers are archived (soft-deleted) through `delete`.
 *
 * Through `persistActions` rather than SQL, deliberately (a recorded deviation from the E0
 * plan's original migration shape): a container conversion is a batch of ordinary,
 * attributable workspace actions, and the audit trail of "who moved what, when, why" is
 * exactly what a reader of a converted record will want. Nothing here is a schema change.
 */
import { loadWorkspace } from '../lib/db/repo'
import { persistActions } from '../lib/db/persist'
import type { Action } from '../lib/workspace'
import type { Actor } from '../lib/actor'
import type { TenantId } from '../lib/tenant'

const APPLY = process.argv.includes('--apply')
const TENANT = (process.env.AXIOMATE_TENANT ?? 'axiocloud') as TenantId
const ACTOR: Actor = { id: 'module-conversion', name: process.env.AXIOMATE_OPERATOR ?? 'Operator' }
const NOW = new Date().toISOString()

async function main() {
  const { state } = await loadWorkspace(TENANT)

  const modules = Object.values(state.nodes).filter((n) => n.kind === 'module' && !n.deletedAt)
  if (!modules.length) {
    console.log(`${TENANT}: no live Process Area containers — nothing to convert.`)
    return
  }
  const moduleIds = new Set(modules.map((m) => m.id))

  /* ---- 1. intake retargets ---- */
  const retargets: Action[] = []
  for (const box of state.model.intake ?? []) {
    if (!moduleIds.has(box.scopeId)) continue
    const m = state.nodes[box.scopeId]
    retargets.push({
      t: 'config',
      op: { k: 'upsertIntake', id: box.id, patch: { scopeId: m.parentId ?? '', classification: m.name } },
      now: NOW,
    } as Action)
    console.log(`  mailbox ${box.address}: scope ${box.scopeId} ("${m.name}") -> ${m.parentId}, classification "${m.name}"`)
  }
  for (const form of state.model.intakeForms ?? []) {
    if (!moduleIds.has(form.scopeId)) continue
    const m = state.nodes[form.scopeId]
    retargets.push({
      t: 'config',
      op: { k: 'upsertIntakeForm', id: form.id, patch: { scopeId: m.parentId ?? '' } },
      now: NOW,
    } as Action)
    console.log(`  form ${form.id}: scope ${form.scopeId} -> ${m.parentId} (forms carry no classification; the walk decides)`)
  }

  /* ---- 2. issue moves ---- */
  const moves: Action[] = []
  for (const i of Object.values(state.issues)) {
    if (i.deletedAt || !i.parentId || !moduleIds.has(i.parentId)) continue
    const m = state.nodes[i.parentId]
    if (!m.parentId) {
      console.error(`  ${i.id}: its container ${m.id} has no parent — skipping, investigate by hand.`)
      continue
    }
    moves.push({ t: 'move', id: i.id, newParentId: m.parentId, now: NOW } as Action)
  }

  /* ---- 3. archive the containers ---- */
  // 'reparent' mode is the safety net, not the plan: phase 2 has already moved every live
  // issue off the container, so there is nothing left to reparent — but if one slipped in
  // between load and apply, it survives under the container's parent instead of vanishing.
  const archives: Action[] = modules.map(
    (m) => ({ t: 'softDelete', id: m.id, mode: 'reparent', now: NOW }) as Action,
  )

  console.log(`\n${TENANT}: ${retargets.length} intake retarget(s), ${moves.length} issue move(s), ${archives.length} container(s) to archive.`)
  if (!APPLY) {
    console.log('Dry run — nothing written. Re-run with --apply.')
    return
  }

  /* Batched, order preserved: retargets first so intake never points at an archived scope;
     archives last so no container goes while something still lives under it. */
  const all = [...retargets, ...moves, ...archives]
  for (let at = 0; at < all.length; at += 50) {
    const slice = all.slice(at, at + 50)
    const r = await persistActions(TENANT, ACTOR, slice)
    if (!r.ok) {
      console.error(`\nBatch starting at ${at} refused: ${r.error}`)
      console.error('Everything before this batch has applied; nothing after it has. Re-run resumes safely — done moves and archives are no-ops or skips.')
      process.exit(1)
    }
    console.log(`  applied ${at + slice.length}/${all.length}`)
  }

  /* ---- verify ---- */
  const after = (await loadWorkspace(TENANT)).state
  const liveModules = Object.values(after.nodes).filter((n) => n.kind === 'module' && !n.deletedAt)
  const orphans = Object.values(after.issues).filter(
    (i) => !i.deletedAt && i.parentId && moduleIds.has(i.parentId),
  )
  const blank = Object.values(after.issues).filter((i) => !i.deletedAt && !i.module)
  console.log(`\nAfter: live module containers=${liveModules.length} (want 0), issues still on a container=${orphans.length} (want 0), issues with no label=${blank.length} (want 0).`)
  if (liveModules.length || orphans.length) process.exit(1)
}

await main()
