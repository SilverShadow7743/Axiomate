/**
 * Run the Estimation agent over issues that have no estimate.
 *
 * The register holds 216 live issues and, until this runs, zero estimates. That is not a gap in
 * the data so much as a gap in what anybody can plan: with no complexity scored, every derived
 * figure the application can produce — size, hours, working days, projected finish — has nothing
 * to derive from, so the capacity and schedule screens are honest and empty.
 *
 * ---------------------------------------------------------------------------
 * What it writes, and what it refuses to write
 *
 * It writes the five complexity scores and the assumptions that explain them, through the
 * ordinary `setEstimate` action — so attribution, the audit trail and permissions apply exactly
 * as they do to a consultant typing the same numbers.
 *
 * It does NOT write hours, size, days or a finish date. Those are derived from the scores by the
 * firm's own size-band calibration, and writing them here would freeze a number against a
 * calibration that can change — the rule that keeps `duration` and `scheduleHealth` out of the
 * schema.
 *
 * It does NOT baseline anything. `baselinedAt` stays null, which is the difference between an
 * estimate and an *agreed* estimate, and it is the entire safeguard: a baselined estimate is a
 * commitment somebody made, and no machine is entitled to make one.
 *
 * It does NOT touch an issue that already has an estimate. Overwriting a consultant's judgement
 * with a keyword match, silently, at scale, is the worst thing this script could do.
 *
 * It does NOT set `waitDays`. The type comments say "entered, never inferred", and how long a
 * client will take to answer is not in the text of an issue.
 *
 * An issue the agent cannot read gets **no estimate at all** rather than a middling one. That is
 * the case worth watching in the output: a large unreadable count means the rules need extending,
 * and it is visible instead of being buried under a register of plausible 3s.
 *
 *   npx tsx --conditions=react-server scripts/estimate-backlog.ts            # dry run
 *   npx tsx --conditions=react-server scripts/estimate-backlog.ts --explain  # + the reasoning
 *   npx tsx --conditions=react-server scripts/estimate-backlog.ts --apply
 *   npx tsx --conditions=react-server scripts/estimate-backlog.ts --apply --limit 20
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { loadWorkspace } from '../lib/db/repo'
import { persistActions } from '../lib/db/persist'
import { proposeEstimate, assumptionsFor, type EstimateDomain } from '../lib/estimator'
import { deriveEffort, emptyEstimate } from '../lib/estimation'
import type { Action } from '../lib/workspace'
import type { TenantId } from '../lib/tenant'
import { ESTIMATION_ACTOR, type Actor } from '../lib/actor'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const EXPLAIN = argv.includes('--explain')
const LIMIT = (() => {
  const i = argv.indexOf('--limit')
  return i === -1 ? Infinity : Number(argv[i + 1]) || Infinity
})()

const TENANT = (process.env.AXIOMATE_TENANT ?? 'axiocloud') as TenantId
const AGENT_NAME = 'Estimation agent'

/*
 * A machine actor, and it says so. `by` is what History shows, and showing a person's name for a
 * hundred estimates nobody wrote would put a consultant's name on a machine's guess.
 *
 * `ESTIMATION_ACTOR` rather than a literal, because the `machine:` prefix is what `isMachineActor`
 * tests and therefore what decides whether the automation role applies at all.
 */
const ACTOR: Actor = ESTIMATION_ACTOR
const NOW = new Date().toISOString()

/**
 * Which register an issue belongs to, and therefore whether this agent knows anything about it.
 *
 * Two registers share this workspace. OAPIL and SLG are Dynamics 365 finance-and-operations
 * deliveries, which is what the agent's rules are drawn from. `Axiocloud` is Axiomate's **own
 * product backlog** — this application's issues, about React components, sign-in and agents —
 * and the ERP vocabulary means nothing there.
 *
 * Decided by client rather than by reading the text, because reading the text is exactly the
 * thing that failed: an item about speech-to-text matched three ERP rules and proposed a hundred
 * and sixty hours with a confident explanation about accounting policy.
 *
 * A firm adding a third client gets `other` until somebody says otherwise, which is the safe
 * direction — the failure is "no estimate" rather than "a wrong one that reads as right".
 */
function domainOf(client: string): EstimateDomain {
  return client === 'OAPIL' || client === 'SLG' ? 'd365-fo' : 'other'
}

async function main() {
  const { state } = await loadWorkspace(TENANT)
  const bands = state.model.sizeBands

  const live = Object.values(state.issues).filter((i) => !i.deletedAt)
  const already = live.filter((i) => state.estimates[i.id])
  const candidates = live.filter((i) => !state.estimates[i.id])

  const actions: Action[] = []
  const unreadable: string[] = []
  const outOfDomain: string[] = []
  const sized: Record<string, number> = {}
  const rows: { id: string; size: string; hours: string; rules: string; subject: string }[] = []

  for (const issue of candidates) {
    if (actions.length >= LIMIT) break

    const proposal = proposeEstimate(
      {
        subject: issue.subject,
        description: issue.description,
        module: issue.module,
        type: issue.type,
        severity: issue.severity,
      },
      domainOf(issue.client),
    )

    if (proposal.outcome === 'out-of-domain') {
      outOfDomain.push(`${issue.id}  ${issue.module} — ${issue.description.slice(0, 56)}`)
      continue
    }
    if (!proposal.scored) {
      unreadable.push(`${issue.id}  ${issue.module} — ${issue.description.slice(0, 60)}`)
      continue
    }

    // Derived here only to SHOW what the scores imply before anybody commits to them. The
    // numbers are not written; `deriveEffort` recomputes them on every read from the scores and
    // the bands, which is the point.
    const effort = deriveEffort(
      { ...emptyEstimate(NOW.slice(0, 10)), scores: proposal.scores },
      bands,
    )
    const size = effort.size ?? '—'
    sized[size] = (sized[size] ?? 0) + 1

    rows.push({
      id: issue.id,
      size,
      hours: effort.effortHours != null ? `${effort.effortHours}h` : '—',
      rules: proposal.summary,
      subject: issue.description.slice(0, 46),
    })

    actions.push({
      t: 'setEstimate',
      issueId: issue.id,
      patch: {
        scores: proposal.scores,
        confidence: proposal.confidence,
        assumptions: assumptionsFor(proposal, AGENT_NAME),
      },
      now: NOW,
    } as Action)

    if (EXPLAIN) {
      console.log(`\n${issue.id}  ${issue.module} — ${issue.description.slice(0, 70)}`)
      const s = proposal.scores
      console.log(`  business ${s.business}  technical ${s.technical}  integration ${s.integration}  testing ${s.testing}  data ${s.data}   -> ${size} ${effort.effortHours ?? '—'}h`)
      for (const b of proposal.basis) console.log(`    ${b}`)
    }
  }

  console.log('\nAXIOMATE — ESTIMATION AGENT\n')
  console.log(`  live issues        : ${live.length}`)
  console.log(`  already estimated  : ${already.length}  (never touched)`)
  console.log(`  proposed here      : ${actions.length}`)
  console.log(`  left unscored      : ${unreadable.length}  (read, nothing recognised)`)
  console.log(`  outside its domain : ${outOfDomain.length}  (Axiomate's own backlog, not an ERP delivery)`)

  if (!EXPLAIN && rows.length) {
    console.log('\n  id           size  hours  rules')
    for (const r of rows.slice(0, 25)) {
      console.log(`  ${r.id.padEnd(12)} ${r.size.padEnd(5)} ${r.hours.padEnd(6)} ${r.rules}`)
    }
    if (rows.length > 25) console.log(`  … and ${rows.length - 25} more (use --explain for all, with reasoning)`)
  }

  const spread = Object.entries(sized).sort((a, b) => b[1] - a[1])
  if (spread.length) {
    console.log(`\n  size spread        : ${spread.map(([s, n]) => `${s} ${n}`).join('  ')}`)
  }

  if (unreadable.length) {
    console.log(`\n  Left unscored — the agent recognised nothing in these, and an unscored`)
    console.log(`  estimate is better than a middling one nobody read:`)
    for (const u of unreadable.slice(0, 12)) console.log(`    ${u}`)
    if (unreadable.length > 12) console.log(`    … and ${unreadable.length - 12} more`)
  }

  if (outOfDomain.length) {
    console.log(`\n  Outside its domain — Axiomate's own product backlog. The rules are drawn`)
    console.log(`  from Dynamics 365 delivery and mean nothing here, so nothing was proposed:`)
    for (const u of outOfDomain.slice(0, 6)) console.log(`    ${u}`)
    if (outOfDomain.length > 6) console.log(`    … and ${outOfDomain.length - 6} more`)
  }

  console.log('\n  None of these is baselined. An estimate is a proposal until somebody agrees it.')

  if (!actions.length) {
    console.log('\nNothing to do.')
    return
  }
  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply, or --explain to see the reasoning first.')
    return
  }

  /*
   * In chunks, because `persistActions` runs one serializable transaction and two hundred
   * estimates in a single one holds a write lock over the whole table for the duration. The
   * batch is idempotency-keyed per action, so a chunk that fails leaves the ones before it
   * written and can be re-run — which is why the script skips issues that already have one.
   */
  const CHUNK = 40
  let done = 0
  for (let i = 0; i < actions.length; i += CHUNK) {
    const slice = actions.slice(i, i + CHUNK)
    const result = await persistActions(TENANT, ACTOR, slice)
    if (!result.ok) {
      console.error(`\nRefused after ${done}: ${result.error}`)
      process.exitCode = 1
      return
    }
    done += slice.length
    console.log(`  written ${done}/${actions.length}`)
  }
  console.log(`\nProposed ${done} estimates. None baselined.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
