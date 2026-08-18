/**
 * Convert stored mail markup in issue descriptions to text.
 *
 *   npx tsx --conditions=react-server scripts/repair-markup.ts           # dry run, the default
 *   npx tsx --conditions=react-server scripts/repair-markup.ts --apply
 *
 * A one-off, behind `scripts/find-markup.ts`, which is the read-only scan that found the work.
 *
 * ---------------------------------------------------------------------------
 * Why there is anything to repair
 *
 * Client mail arrives as HTML on purpose — `infra/intake.bicep` records rejecting the Content
 * Conversion connector because it discards hyperlinks and hard-wraps. That was right and it was
 * half a decision: nothing on this side converted anything, so every issue intake created carries
 * the raw document. `lib/intake.ts`'s `htmlToText` is the other half and fixes messages arriving
 * from now on. This fixes the ones already stored.
 *
 * ---------------------------------------------------------------------------
 * One side effect, stated rather than discovered
 *
 * This goes through `updateIssue`, which stamps `lastActivity` with today. That is not ideal — a
 * markup cleanup is not somebody working the issue, and `daysSinceActivity` is what answers "has
 * anyone touched this".
 *
 * It is accepted rather than engineered around, and the reason is arithmetic: every affected
 * issue currently sits at 17 or 18 August and every one is Open, so the stamp moves 24 records by
 * a single day and 4 by none, on issues that genuinely are active. Building a second write path
 * that skips the stamp would mean a new reducer arm, a new permission and a new wire shape to
 * avoid a one-day shift on records nobody would call stale either way.
 *
 * If this is ever run against a workspace where the affected issues are old, that trade stops
 * holding and the arm should be built. The check below prints the spread so the decision is made
 * on the data rather than on this comment.
 *
 * ---------------------------------------------------------------------------
 * What it refuses
 *
 * A conversion that collapses. If the text that comes out is tiny next to what went in, the
 * document was structured in a way this converter does not understand, and replacing a client's
 * message with a fragment is worse than leaving the markup alone. Those are reported and skipped
 * rather than applied, because a repair that quietly destroys the thing it was repairing is the
 * only genuinely bad outcome available here.
 *
 * The stored markup is REPLACED, not kept. The original message is still in the mailbox intake
 * filed it from — the provenance note on each issue names it — and keeping a second copy of every
 * client email as markup nobody reads is a cost with no reader.
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { loadWorkspace } from '../lib/db/repo'
import { persistActions } from '../lib/db/persist'
import { htmlToText } from '../lib/intake'
import type { Action } from '../lib/workspace'
import type { TenantId } from '../lib/tenant'
import type { Actor } from '../lib/actor'

const APPLY = process.argv.includes('--apply')
const TENANT = (process.env.AXIOMATE_TENANT ?? 'axiocloud') as TenantId
const NOW = new Date().toISOString()

/** Same test as the scan: a plausible tag, not merely a `<`. See `find-markup.ts`. */
const TAG = /<\/?[a-z][a-z0-9]*(\s[^<>]*)?>/i

/**
 * A conversion this refuses to apply.
 *
 * Both limbs matter. The absolute floor catches a document that reduced to a line; the ratio
 * catches a large one that reduced to a paragraph, which is the shape a converter produces when
 * it has not understood the structure at all.
 */
function collapsed(before: string, after: string): boolean {
  if (after.trim().length < 40) return true
  return after.length / before.length < 0.02
}

const REASON =
  'Stored mail markup converted to text. The message arrived as HTML, which the mailbox connector passes through unchanged; the original is still in the mailbox this issue was filed from.'

async function main() {
  const { state } = await loadWorkspace(TENANT)

  const wanted = (process.env.AXIOMATE_OPERATOR_EMAIL ?? 'sekharn@axiocloudsolutions.com').toLowerCase()
  const operator = Object.values(state.model.people).find((p) => p.email?.toLowerCase() === wanted)
  if (!operator) {
    console.log(`  No directory entry has ${wanted}, so nothing here would be permitted.`)
    process.exitCode = 1
    return
  }
  const ACTOR: Actor = { id: operator.id, name: operator.name, email: operator.email }

  const candidates = Object.values(state.issues)
    .filter((i) => !i.deletedAt && TAG.test(i.description ?? ''))
    .sort((a, b) => a.id.localeCompare(b.id))

  console.log('AXIOMATE — MARKUP REPAIR\n')
  console.log(`  attributed to : ${operator.name} (${operator.id})`)
  console.log(`  candidates    : ${candidates.length}\n`)

  if (!candidates.length) {
    console.log('  Nothing to repair.')
    return
  }

  const doable: { id: string; before: string; after: string }[] = []
  const refused: { id: string; before: number; after: number }[] = []

  for (const issue of candidates) {
    const before = issue.description ?? ''
    const after = htmlToText(before)
    if (collapsed(before, after)) {
      refused.push({ id: issue.id, before: before.length, after: after.length })
      continue
    }
    doable.push({ id: issue.id, before, after })
  }

  console.log('  ID         chars before →  after    first line of the result')
  console.log('  ' + '-'.repeat(94))
  for (const d of doable) {
    const first = d.after.split('\n').find((l) => l.trim())?.slice(0, 46) ?? ''
    console.log(
      `  ${d.id.padEnd(10)} ${String(d.before.length).padStart(7)} → ${String(d.after.length).padStart(7)}    ${first}`,
    )
  }

  const savedChars = doable.reduce((n, d) => n + (d.before.length - d.after.length), 0)
  console.log(
    `\n  ${doable.length} to convert, ${Math.round(savedChars / 1024)} KB removed from the page payload every browser loads.`,
  )

  if (refused.length) {
    console.log(`\n  REFUSED — the conversion collapsed, so the markup is left alone:`)
    for (const r of refused) console.log(`    ${r.id}  ${r.before} → ${r.after} chars`)
  }

  /* The side effect, printed from the data rather than asserted from the comment above. */
  const spread = new Map<string, number>()
  for (const d of doable) {
    const la = state.issues[d.id].lastActivity
    spread.set(la, (spread.get(la) ?? 0) + 1)
  }
  console.log('\n  lastActivity will be stamped to today. Current spread:')
  for (const [date, n] of [...spread].sort()) console.log(`    ${date}  ${n}`)

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply.')
    return
  }

  /*
   * In batches. The payload here is large — over a megabyte of description across the set — and
   * one transaction carrying all of it is a transaction that holds locks for as long as it takes
   * to write. Five at a time keeps each one short, and a failure part-way leaves the earlier
   * batches applied rather than losing the run.
   */
  let done = 0
  for (let i = 0; i < doable.length; i += 5) {
    const slice = doable.slice(i, i + 5)
    const actions: Action[] = slice.map(
      (d) =>
        ({
          t: 'updateIssue',
          id: d.id,
          patch: { description: d.after },
          reason: REASON,
          now: NOW,
        }) as Action,
    )
    const result = await persistActions(TENANT, ACTOR, actions)
    if (!result.ok) {
      console.log(`\n  Refused at ${slice[0].id}: ${result.error}`)
      console.log(`  ${done} converted before this. Re-running is safe — converted text has no tags left to match.`)
      process.exitCode = 1
      return
    }
    done += slice.length
    console.log(`  ${done}/${doable.length}…`)
  }

  const { state: after } = await loadWorkspace(TENANT)
  const left = Object.values(after.issues).filter((i) => !i.deletedAt && TAG.test(i.description ?? ''))
  console.log(`\n  Converted ${done}. Issues still carrying markup: ${left.length}${left.length ? ` (${left.map((i) => i.id).join(', ')})` : ''}`)
  console.log('  Each conversion is on the audit trail with its reason.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
