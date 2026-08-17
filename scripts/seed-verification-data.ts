/**
 * Put enough in the workspace that the browser checklist has something to click.
 *
 *   npx tsx --conditions=react-server scripts/seed-verification-data.ts           # report only
 *   npx tsx --conditions=react-server scripts/seed-verification-data.ts --apply
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 *
 * Six entities were built in one day — rates, change requests, skills, documents, milestones —
 * and every one of them landed in a workspace with no statement of work, no rate, no skill and
 * no milestone in it. A screen with an empty table verifies its empty state and nothing else, so
 * the checklist needs a floor to stand on.
 *
 * ---------------------------------------------------------------------------
 * What it will NOT seed, and why that is the important half
 *
 * **No skill levels against colleagues.** A recorded level is a judgement about a named person,
 * and this script has not worked with any of them. Seeding "Amolak — Practitioner" would put a
 * performance assessment nobody made into a system that redacts them precisely because they are
 * sensitive. The catalogue is seeded so the form is usable; who is at what level is for people
 * to enter, and the checklist has a step for exactly that.
 *
 * **No cost or charge-out rates against colleagues.** Same reason, sharper: a cost rate is what
 * somebody is paid. The one exception is the operator's own row, because it is their own data
 * and it makes cost and margin checkable at all.
 *
 * **No leave.** Recording that a named person is away when they are not is a false entry in a
 * diary other people plan against.
 *
 * ---------------------------------------------------------------------------
 * Everything goes through the reducer
 *
 * Nothing here writes a row directly. Every record is an `Action` through `persistActions`, so
 * it is validated, permission-checked, attributed and audited exactly as a person's click would
 * be. The trail names the OPERATOR — see the note on the actor below for why an invented seed
 * identity cannot work here — and every seeded record's reason or note says it was seeded, so a
 * reader can tell sample data from the real thing without consulting this file.
 *
 * ---------------------------------------------------------------------------
 * The sample commercial record is deliberately not on a client engagement
 *
 * It goes on the engagement named "Test". Sample contract values must never sit under OAPIL or
 * SLG, where somebody reading the screen in six weeks would take them for the real thing. The
 * figures themselves are the worked example from the firm's own pricing model — Service 2.1,
 * Core Finance Implementation — which that workbook labels illustrative on its own front page.
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { loadWorkspace } from '../lib/db/repo'
import { persistActions } from '../lib/db/persist'
import type { Action } from '../lib/workspace'
import type { TenantId } from '../lib/tenant'
import type { Actor } from '../lib/actor'

const APPLY = process.argv.includes('--apply')
const TENANT = (process.env.AXIOMATE_TENANT ?? 'axiocloud') as TenantId

/**
 * The seed runs AS THE OPERATOR, and the first draft of this script got that wrong.
 *
 * It invented `{ id: 'seed-verification', name: 'Verification Seed' }` so the trail would name
 * the script rather than a person — which reads well and does not work: `defaultRoleIds` is `[]`
 * in this workspace (correctly, now that there is a login), so an actor who is not in the
 * directory holds no roles and every action here is refused. `reconcile-grants` appears to work
 * only because it reads `AXIOMATE_OPERATOR` and happens to name-match a real person.
 *
 * So the honest arrangement is the one where the record matches reality: the operator asked for
 * this data, the operator's grants are what authorise it, and the trail says the operator — with
 * `byId` and `byEmail` resolved from the directory rather than left to a name match, which is the
 * half-join that pending-actions F1 records as a defect in an earlier script.
 *
 * The consequence for the checklist is stated rather than engineered around: because the seed is
 * the operator, the operator cannot then decide the change request it raises or accept the
 * milestone it delivers. The reducer refuses both, deliberately, and the checklist verifies the
 * refusal and says a second signed-in person is needed to complete those two flows.
 */

const TODAY = new Date().toISOString().slice(0, 10)
const NOW = new Date().toISOString()

/**
 * The firm's own vocabulary, taken from the streams and tracks in its pricing model rather than
 * invented: Finance, SCM, Manufacturing, Commerce, F&O Platform (X++), Data & AI, Power Platform,
 * Cross-Functional. A starting catalogue to be edited, not a definitive one.
 */
const SKILLS: { name: string; category: string; description: string }[] = [
  { name: 'General ledger & financial close', category: 'D365 Finance', description: 'Chart of accounts, period close, consolidation.' },
  { name: 'Accounts payable & receivable', category: 'D365 Finance', description: 'Vendor and customer transaction cycles.' },
  { name: 'Intercompany & eliminations', category: 'D365 Finance', description: 'Cross-entity postings and group reporting.' },
  { name: 'Fixed assets', category: 'D365 Finance', description: 'Acquisition, depreciation, disposal.' },
  { name: 'Procurement & sourcing', category: 'D365 Supply Chain', description: 'Requisition to purchase order to receipt.' },
  { name: 'Inventory & warehouse management', category: 'D365 Supply Chain', description: 'WMS, locations, put-away and picking strategies.' },
  { name: 'Production control', category: 'D365 Manufacturing', description: 'BOMs, routes, production orders, subcontracting.' },
  { name: 'Master planning', category: 'D365 Manufacturing', description: 'MRP, coverage settings, planned order firming.' },
  { name: 'Retail & commerce', category: 'D365 Commerce', description: 'POS, channels, retail statement posting.' },
  { name: 'X++ development', category: 'F&O Platform', description: 'Extensions, chain of command, event handlers.' },
  { name: 'Data entities & DMF', category: 'F&O Platform', description: 'Import/export, data packages, migration templates.' },
  { name: 'Integration & APIs', category: 'F&O Platform', description: 'OData, custom services, message-based integration.' },
  { name: 'Power Platform', category: 'Power Platform', description: 'Power Apps, Power Automate, Dataverse.' },
  { name: 'Power BI & Fabric', category: 'Data & AI', description: 'Semantic models, reporting, the analytics platform.' },
  { name: 'Data migration & cleansing', category: 'Data & AI', description: 'Extract, map, cleanse, reconcile, cut over.' },
  { name: 'Test management', category: 'Cross-Functional', description: 'Test strategy, scripts, regression suites, UAT.' },
  { name: 'Cutover & go-live management', category: 'Cross-Functional', description: 'Cutover plan, rehearsal, hypercare.' },
  { name: 'Change management & training', category: 'Cross-Functional', description: 'Adoption, materials, delivery.' },
]

/** The worked example from the firm's own pricing model. Illustrative in the source, and here. */
const SAMPLE_SOW = {
  reference: 'SAMPLE-2.1',
  title: 'Core Finance Implementation (sample — from the pricing model)',
  effortHours: 2860,
  value: 295_000,
  currency: 'USD',
  scope:
    'Seeded for browser verification. Figures are the worked example for Service 2.1 in Axiocloud_Pricing_Estimation_Model.xlsx — 2,860 hours, quoted 295,000 USD over 16 weeks — which that workbook marks illustrative until Finance loads actual payroll. This is not a real contract. Replace it with the real OAPIL and SLG statements of work, or archive it.',
}

/** 25/35/25/15, the shape the pricing model names for a fixed-fee implementation. */
const MILESTONES = [
  { name: 'Analysis & design sign-off', percentage: 25, weeks: 4 },
  { name: 'Build & configuration complete', percentage: 35, weeks: 9 },
  { name: 'UAT complete', percentage: 25, weeks: 13 },
  { name: 'Go-live & hypercare exit', percentage: 15, weeks: 16 },
]

function plus(days: number): string {
  const d = new Date(`${TODAY}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

async function main() {
  const { state } = await loadWorkspace(TENANT)

  console.log('AXIOMATE — VERIFICATION SEED\n')

  /* The engagement to hang the sample contract off. Never a client one. */
  const testEngagement = Object.values(state.nodes).find(
    (n) => n.kind === 'engagement' && !n.deletedAt && /^test$/i.test(n.name),
  )
  if (!testEngagement) {
    console.log('  No engagement named "Test" exists. Refusing to put a sample contract under a')
    console.log('  client engagement — create one called "Test" first, or say which to use.')
    process.exitCode = 1
    return
  }

  const wanted = (process.env.AXIOMATE_OPERATOR_EMAIL ?? 'sekharn@axiocloudsolutions.com').toLowerCase()
  const operator = Object.values(state.model.people).find((p) => p.email?.toLowerCase() === wanted)
  if (!operator) {
    console.log(`  No directory entry has the address ${wanted}. Refusing to run: without one the`)
    console.log('  actor holds no roles (defaultRoleIds is empty) and every write would be refused.')
    process.exitCode = 1
    return
  }
  /* Id first, so the trail is queryable by account rather than only readable as a name. */
  const SEED: Actor = { id: operator.id, name: operator.name, email: operator.email }

  const existingSkills = new Set(
    Object.values(state.model.skills ?? {}).filter((s) => !s.deletedAt).map((s) => s.name.toLowerCase()),
  )
  const newSkills = SKILLS.filter((s) => !existingSkills.has(s.name.toLowerCase()))
  const existingSow = Object.values(state.sows).find((s) => s.reference === SAMPLE_SOW.reference && !s.deletedAt)

  console.log(`  engagement            : ${testEngagement.name} (${testEngagement.id})`)
  console.log(`  skills to add         : ${newSkills.length} of ${SKILLS.length} (${SKILLS.length - newSkills.length} already there)`)
  console.log(`  sample SOW            : ${existingSow ? `already exists (${existingSow.id}) — will not duplicate` : 'will be created'}`)
  console.log(`  milestones            : ${existingSow ? 'skipped' : `${MILESTONES.length} (25/35/25/15)`}`)
  console.log(`  change request        : ${existingSow ? 'skipped' : '1, submitted for a decision'}`)
  console.log(`  attributed to         : ${operator.name} (${operator.id}) — see the note on SEED`)
  console.log(`  operator's own rates  : cost and charge-out, illustrative`)
  console.log()
  console.log('  NOT seeded, deliberately: skill levels or rates for anybody else. Those are')
  console.log('  judgements about named colleagues and somebody has to actually make them.')
  console.log()
  console.log('  Because the seed IS the operator, the operator cannot then decide the change')
  console.log('  request it raises or accept the milestone it delivers. That refusal is correct')
  console.log('  and the checklist verifies it; completing either needs a second signed-in person.')

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply.')
    return
  }

  const actions: Action[] = []

  for (const s of newSkills) {
    actions.push({
      t: 'config',
      op: { k: 'upsertSkill', id: null, name: s.name, category: s.category, description: s.description },
      now: NOW,
    } as Action)
  }

  if (!existingSow) {
    actions.push({
      t: 'upsertSow',
      id: null,
      engagementId: testEngagement.id,
      patch: {
        reference: SAMPLE_SOW.reference,
        title: SAMPLE_SOW.title,
        status: 'Active',
        signedOn: plus(-14),
        startDate: plus(-14),
        endDate: plus(98),
        effortHours: SAMPLE_SOW.effortHours,
        value: SAMPLE_SOW.value,
        currency: SAMPLE_SOW.currency,
        scope: SAMPLE_SOW.scope,
        exclusions: 'Sample record — see scope.',
        acceptanceCriteria: 'Sample record — see scope.',
      },
      now: NOW,
    } as Action)
  }

  {
    /*
     * The operator's own rates only, and from the firm's own rate card rather than invented: the
     * pricing model puts an onshore Engagement Manager at 160 USD/hr sell, and the model's
     * onshore delivery cost build-up is what the cost figure reflects. Both are illustrative and
     * the reason field says so, because a rate that looks authoritative and is not is worse than
     * no rate at all.
     */
    actions.push({
      t: 'recordRate', personId: operator.id, kind: 'cost', validFrom: plus(-180), validTo: null,
      amount: 95, currency: 'USD',
      reason: 'Seeded for verification from the firm’s own pricing model (onshore delivery). Illustrative — replace with the real figure.',
      now: NOW,
    } as Action)
    actions.push({
      t: 'recordRate', personId: operator.id, kind: 'bill', validFrom: plus(-180), validTo: null,
      amount: 160, currency: 'USD',
      reason: 'Seeded for verification — the rate card’s onshore Engagement Manager sell rate. Illustrative.',
      now: NOW,
    } as Action)
  }

  const first = await persistActions(TENANT, SEED, actions)
  console.log(`\n  ${first.ok ? 'Applied' : 'Refused'}: ${first.message ?? first.error} (${first.audited} audit entries)`)
  if (!first.ok) {
    process.exitCode = 1
    return
  }

  /*
   * The milestones and the change request need the SOW's id, which only exists after the batch
   * above committed. A second pass rather than a guess at the counter.
   */
  if (!existingSow) {
    const { state: mid } = await loadWorkspace(TENANT)
    const sow = Object.values(mid.sows).find((s) => s.reference === SAMPLE_SOW.reference && !s.deletedAt)
    if (!sow) {
      console.log('  The sample SOW did not come back after writing. Nothing further seeded.')
      process.exitCode = 1
      return
    }

    const second: Action[] = MILESTONES.map((m) => ({
      t: 'upsertMilestone',
      id: null,
      sowId: sow.id,
      patch: {
        name: m.name,
        basis: 'percentage' as const,
        percentage: m.percentage,
        billOn: 'acceptance' as const,
        plannedDate: plus(m.weeks * 7 - 14),
        description: 'Seeded for verification.',
      },
      now: NOW,
    })) as Action[]

    second.push({
      t: 'upsertChangeRequest',
      id: null,
      sowId: sow.id,
      patch: {
        title: 'Additional intercompany scope',
        effortHours: 160,
        value: 18_000,
        currency: 'USD',
        scope: 'Two extra legal entities in the intercompany rollout.',
        reason: 'Seeded for verification, so there is a change waiting for a decision. Raised by the seed rather than by a person, so whoever is testing can decide it — the reducer refuses to let the raiser decide their own.',
        effectiveFrom: null,
      },
      submit: true,
      now: NOW,
    } as Action)

    const r2 = await persistActions(TENANT, SEED, second)
    console.log(`  ${r2.ok ? 'Applied' : 'Refused'}: milestones + change request — ${r2.message ?? r2.error}`)
    if (!r2.ok) { process.exitCode = 1; return }

    /*
     * The first milestone is marked delivered so the schedule has something in each state to
     * look at. It cannot then be accepted by the same person — the reducer refuses that, which
     * is the rule working — so the checklist treats the refusal as the thing to verify and says
     * plainly that completing an acceptance needs a second signed-in person.
     */
    const { state: withMs } = await loadWorkspace(TENANT)
    const ms = Object.values(withMs.milestones)
      .filter((m) => m.sowId === sow.id && !m.deletedAt)
      .sort((a, b) => a.sequence - b.sequence)[0]
    if (ms) {
      const r3 = await persistActions(TENANT, SEED, [
        { t: 'deliverMilestone', id: ms.id, now: NOW } as Action,
      ])
      console.log(`  ${r3.ok ? 'Applied' : 'Refused'}: first milestone marked delivered — ${r3.message ?? r3.error}`)
    }
  }

  console.log(`\n  Done. Attributed to ${operator.name} in the trail — see the note on the actor for`)
  console.log('  why an invented seed identity cannot work here. Every seeded record says it was')
  console.log('  seeded in its own reason or note, and the sample contract is on the Test')
  console.log('  engagement only, never under a client.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
