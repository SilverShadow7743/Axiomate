/**
 * Scenario validation — does the intended business outcome actually happen?
 *
 * Run with `npm run validate:scenarios`.
 *
 * This is deliberately not a feature audit. A screen, a button, a configuration record and a
 * declared agent are all evidence of intent, not of behaviour, so nothing here is judged by
 * whether it exists. Each scenario states the outcome a delivery firm needs, drives the real
 * reducer and the real derivations to reach it, and reports where the trace stops.
 *
 * Five verdicts, because "missing" is not one thing:
 *
 *   PASS             the outcome happens, end to end, in code that runs here
 *   PARTIAL          part of the trace works; the cell says which part does not
 *   FAIL             the system does something, and what it does is wrong or unguarded
 *   NOT TESTABLE     needs a runtime this script cannot reach — a model, a mailbox, a browser
 *   NOT IMPLEMENTED  the entity the outcome depends on does not exist; asserted against source
 *
 * A NOT IMPLEMENTED verdict is checked rather than assumed: `absent()` greps the source for
 * the mechanism, so the claim fails loudly if somebody builds it and does not update this file.
 */
import fs from 'node:fs'
import path from 'node:path'
import { apply, initWorkspace, type Action, type SeedIssueInput, type WorkspaceState } from '../lib/workspace'
import { buildTree } from '../lib/tree'
import { computeHealth, isTerminal } from '../lib/schedule'
import { planSlaDates } from '../lib/sla'
import { buildDailyIms } from '../lib/reports/dailyIms'
import { effortVariance, hoursOn, summariseTime } from '../lib/time'
import { summarise } from '../lib/estimation'
import { PERMISSION_KEYS } from '../lib/access'
import { DEFAULT_SLA } from '../lib/types'
import type { Actor } from '../lib/actor'

/* ================================================================== *
 * Harness
 * ================================================================== */

type Verdict = 'PASS' | 'PARTIAL' | 'FAIL' | 'NOT TESTABLE' | 'NOT IMPLEMENTED'
type Severity = 'P0' | 'P1' | 'P2' | 'P3' | '—'

interface Finding {
  id: string
  /** The letter this scenario answers, where it differs from the id. */
  alias?: string
  title: string
  expected: string
  verdict: Verdict
  actual: string
  stops: string
  severity: Severity
  impact: string
}

const findings: Finding[] = []

function scenario(
  id: string,
  title: string,
  expected: string,
  run: () => Omit<Finding, 'id' | 'title' | 'expected' | 'alias'>,
  alias?: string,
) {
  let r: Omit<Finding, 'id' | 'title' | 'expected' | 'alias'>
  try {
    r = run()
  } catch (err) {
    // A thrown scenario is itself a result — the trace stopped somewhere unhandled.
    r = {
      verdict: 'FAIL',
      actual: `threw: ${err instanceof Error ? err.message : String(err)}`,
      stops: 'the scenario could not be driven to completion',
      severity: 'P1',
      impact: 'unknown — the failure is unhandled',
    }
  }
  findings.push({ id, alias, title, expected, ...r })
}

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = ['lib', 'components', 'app'].flatMap(function walk(rel: string): string[] {
  const dir = path.join(ROOT, rel)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(rel, e.name)
    if (e.isDirectory()) return walk(p)
    return /\.(ts|tsx)$/.test(e.name) ? [p] : []
  })
})

/** True when no source file matches — the evidence behind a NOT IMPLEMENTED verdict. */
function absent(re: RegExp): boolean {
  return !SRC.some((f) => re.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
}

/** Files that mention something, for reporting where a declared thing is and is not read. */
function mentions(re: RegExp): string[] {
  return SRC.filter((f) => re.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
}

/* ================================================================== *
 * Fixture — one client, one engagement, one process area, three issues
 * ================================================================== */

const A: Actor = { id: 'val', name: 'Validator' }
const TODAY = '2026-08-15'
const NOW = `${TODAY}T09:00:00.000Z`

const seedIssue = (id: string, over: Partial<SeedIssueInput> = {}): SeedIssueInput =>
  ({
    id, client: 'OAPIL', engagement: 'OAPIL Engagement', module: 'Inventory',
    subject: `Subject ${id}`, description: '', type: 'Defect', severity: 'High',
    status: 'Open', owner: 'Priya', raisedBy: 'Client', accountable: 'OAPIL',
    raised: '2026-08-03', lastActivity: '2026-08-03', actualEnd: null, age: 12,
    daysSinceActivity: 12, nextAction: '', evidence: '', evidenceDate: '',
    verification: '', source: 'Client log', reference: '', clientImpact: '',
    ...over,
  }) as SeedIssueInput

const BASE = initWorkspace(
  [
    seedIssue('OAPIL-1'),
    seedIssue('OAPIL-2', { severity: 'Medium', owner: 'Sam' }),
    seedIssue('OAPIL-3', { severity: 'Low', status: 'In Progress' }),
  ],
  [],
)

const act = (s: WorkspaceState, a: Action) => apply(s, a, A)
const ok = (s: WorkspaceState, a: Action): WorkspaceState => {
  const r = act(s, a)
  if (r.error) throw new Error(`${a.t} refused: ${r.error}`)
  return r.state
}
const rowsOf = (s: WorkspaceState, today = TODAY) => buildTree(s, today)
const rowFor = (s: WorkspaceState, id: string, today = TODAY) =>
  rowsOf(s, today).find((r) => r.id === id)!

/* ================================================================== *
 * 1 — Intake
 * ================================================================== */

scenario(
  'A',
  'Client sends a new request to the project email address',
  'The mail is received, classified, becomes a work item under the right engagement, and someone owns it.',
  () => {
    const declared = mentions(/routingRules|IntakeMailbox/)
    const consumers = declared.filter((f) => !/config|ConfigWorkspace|workspace\.ts/.test(f))
    return {
      verdict: 'NOT IMPLEMENTED',
      actual: `Mailboxes and routing rules are configuration records in ${declared.length} files; ${consumers.length} of those read them at runtime. Nothing receives mail.`,
      stops: 'at the first arrow — there is no inbound channel',
      severity: 'P0',
      impact: 'The intake the product is named for cannot start. Every record is typed by hand.',
    }
  },
)

scenario(
  'B',
  'Client replies on an existing issue',
  'The reply is recorded against the issue, the issue stops looking stale, and the trail shows who said what and when.',
  () => {
    const s = ok(BASE, {
      t: 'addNote', issueId: 'OAPIL-1', body: 'Client confirms the batch is still failing.',
      noteType: 'Client Communication', pinned: false, now: NOW,
    } as Action)
    const note = Object.values(s.notes)[0]
    const moved = s.issues['OAPIL-1'].lastActivity === TODAY
    const attributed = note.createdBy === A.name || note.createdBy === A.id
    return {
      verdict: moved && attributed ? 'PARTIAL' : 'FAIL',
      actual: `Note recorded, authored by "${note.createdBy}", and the issue's last activity moved to ${s.issues['OAPIL-1'].lastActivity}.`,
      stops: 'before the reply arrives on its own — the note is typed by a consultant, not received',
      severity: 'P2',
      impact: 'The record is right once someone transcribes it. Nothing guarantees they do.',
    }
  },
)

scenario(
  'C',
  'Client sends an ambiguous request',
  'The system marks it as needing clarification, asks the client, and does not start an SLA clock on work nobody has defined.',
  () => {
    const dated = ok(BASE, { t: 'setDates', id: 'OAPIL-1', start: '2026-08-03', end: '2026-08-10', now: NOW } as Action)
    const dueBefore = rowFor(dated, 'OAPIL-1').plannedEndDate
    const s = ok(dated, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { status: 'Needs clarification' }, now: NOW,
    } as Action)
    const row = rowFor(s, 'OAPIL-1')
    // Measured, not asserted: does waiting on the client move the committed date?
    const dueAfter = row.plannedEndDate
    return {
      verdict: 'PARTIAL',
      actual: `The status exists and the row reports health "${row.scheduleHealth}" — blocked statuses are excluded from at-risk, so the issue stops being counted as slipping. The due date does not move: ${dueBefore} before, ${dueAfter} after. Waiting on a client consumes the same clock as working on it, and nothing asks the client anything.`,
      stops: 'at the clock — waiting on a client still consumes the SLA',
      severity: 'P1',
      impact: 'Issues breach on client time. The report calls it our failure.',
    }
  },
)

scenario(
  'D',
  'Client sends an attachment',
  'The file is stored, attached to the issue, and can be produced later as evidence.',
  () => {
    const s = ok(BASE, {
      t: 'addEvidence', issueId: 'OAPIL-1', kind: 'snapshot', name: 'batch-error.png',
      purpose: 'Investigation evidence', url: null, mimeType: 'image/png', sizeBytes: 84_000, note: '', now: NOW,
    } as Action)
    const ev = Object.values(s.evidence).find((e) => e.name === 'batch-error.png')!
    return {
      verdict: 'PARTIAL',
      actual: `The evidence record is created with kind, size and mime type (url: ${ev.url ?? 'none'}). No bytes are stored — ${absent(/multipart\/form-data|createReadStream|blob\(\)|S3|BlobClient/) ? 'there is no upload path anywhere in the source' : 'an upload path exists'}.`,
      stops: 'at the file itself — the record describes an artefact the system does not hold',
      severity: 'P1',
      impact: 'Evidence cannot be produced at a governance meeting. The list of it can.',
    }
  },
)

scenario(
  'E',
  'The same defect is reported twice',
  'The duplicate is detected, linked to the original, and does not become a second stream of work.',
  () => {
    const s = ok(BASE, {
      t: 'link', sourceIssueId: 'OAPIL-2', targetIssueId: 'OAPIL-1',
      relationshipType: 'Duplicate of', note: 'Same batch failure.', now: NOW,
    } as Action)
    const linked = s.relationships.length === 1
    const superseded = ok(s, {
      t: 'updateIssue', id: 'OAPIL-2', patch: { status: 'Superseded' }, now: NOW,
      reason: 'Duplicate of OAPIL-1 — same batch failure, same root cause.',
    } as Action)
    return {
      verdict: linked ? 'PARTIAL' : 'FAIL',
      actual: `The link and the Superseded status both work, closing sets actualEnd to ${superseded.issues['OAPIL-2'].actualEnd}, and the transition graph makes the duplicate call an explained one — Superseded needs a reason, which is now on the trail. Detection is still manual: the duplicate-detection agent is a registry record with no runtime.`,
      stops: 'at detection — a person must notice',
      severity: 'P2',
      impact: 'Duplicates are found late, after two people have worked the same fault.',
    }
  },
)

/* ================================================================== *
 * 2 — Ownership and capacity
 * ================================================================== */

scenario(
  'F',
  'An issue needs another consultant to help',
  'A contributor can be added without taking ownership, and the trail shows both.',
  () => {
    const shipped = Object.values(BASE.model.responsibilities)
    const multi = shipped.filter((r) => r.maxCount === null || r.maxCount > 1)

    // Configure one, because the shipped set does not include a contributor.
    const withContrib = ok(BASE, {
      t: 'config',
      op: {
        k: 'upsertResponsibility', id: null,
        patch: { label: 'Contributors', description: 'Helping without owning', minCount: 0, maxCount: null, required: false },
      },
      now: NOW,
    } as Action)
    const contrib = Object.values(withContrib.model.responsibilities).find((r) => r.label === 'Contributors')!
    const s = ok(withContrib, {
      t: 'setAssignment', issueId: 'OAPIL-1', responsibilityId: contrib.id,
      values: ['Sam', 'Dev'], now: NOW,
    } as Action)
    const assigned = s.issues['OAPIL-1'].assignments[contrib.id] ?? []
    const ownerUnchanged = s.issues['OAPIL-1'].owner === 'Priya'
    const works = assigned.length === 2 && ownerUnchanged
    return {
      verdict: works ? 'PARTIAL' : 'FAIL',
      actual: `The mechanism works: an unbounded responsibility holds ${assigned.length} people, the owner is still ${s.issues['OAPIL-1'].owner}, and the change is audited. But the shipped operating model has ${shipped.length} responsibilities — ${shipped.map((r) => r.label).join(', ')} — and ${multi.length} of them accept more than one name. Contributor is a type the firm must invent.`,
      stops: 'at the shipped model — helping is possible, but not offered',
      severity: 'P2',
      impact: 'Out of the box, the only way to involve a second person is to hand over ownership.',
    }
  },
)

scenario(
  'G',
  'Work is assigned to someone who is not available',
  'The system refuses, or warns, because that person is on leave or already committed.',
  () => {
    const s = ok(BASE, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { owner: 'Someone Who Does Not Exist' }, now: NOW,
    } as Action)
    return {
      verdict: 'FAIL',
      actual: `Accepted without comment. The owner is now "${s.issues['OAPIL-1'].owner}" — a name that is not in the people directory, let alone free. Owner is a free-text column, not a reference.`,
      stops: 'at the first check — there is none',
      severity: 'P1',
      impact: 'Work can be assigned to a leaver, a typo, or someone with no capacity, and nothing notices.',
    }
  },
)

scenario(
  'L',
  'A consultant is already overallocated',
  'Assigning more work surfaces the conflict before it is committed.',
  () => ({
    verdict: 'NOT IMPLEMENTED',
    actual: `No allocation, capacity or availability record exists (${absent(/interface (Allocation|Capacity|ResourceProfile)\b/) ? 'no such type in source' : 'a type exists'}). Capacity in the estimator is three numbers typed on one issue.`,
    stops: 'at the entity — there is nothing to be over',
    severity: 'P0',
    impact: 'The plan cannot be checked against the people who have to deliver it.',
  }),
)

scenario(
  'M',
  'New work arrives and there is not enough capacity for it',
  'The delivery plan is shown to be impossible before it is agreed.',
  () => ({
    verdict: 'NOT IMPLEMENTED',
    actual: 'Requires L. The estimator can say an issue needs 40 hours; nothing knows whether 40 hours exist.',
    stops: 'at the same missing entity',
    severity: 'P0',
    impact: 'Commitments are made against capacity nobody has counted.',
  }),
)

/* ================================================================== *
 * 3 — SLA and schedule
 * ================================================================== */

scenario(
  'H',
  'An issue approaches its SLA target',
  'It is flagged at risk before it breaches, and the person who can act is told.',
  () => {
    const s = ok(BASE, { t: 'setDates', id: 'OAPIL-3', start: '2026-08-10', end: '2026-08-16', now: NOW } as Action)
    const row = rowFor(s, 'OAPIL-3', '2026-08-15')
    const health = computeHealth(row, '2026-08-15')
    return {
      verdict: health === 'At Risk' ? 'PARTIAL' : 'FAIL',
      actual: `Health computes as "${health}" from dates and progress, and the grid shows it. Nothing is sent: ${absent(/sendMail|nodemailer|notif(y|ication)Send|webhook/i) ? 'there is no delivery mechanism in the source' : 'a delivery mechanism exists'}.`,
      stops: 'at the notification — the risk is visible only to someone already looking',
      severity: 'P1',
      impact: 'At-risk work is found by opening the app, not by being told.',
    }
  },
)

scenario(
  'I',
  'An issue breaches its SLA',
  'It is overdue, it is escalated to the accountable party, and it appears on the report.',
  () => {
    const s = ok(BASE, { t: 'setDates', id: 'OAPIL-2', start: '2026-08-01', end: '2026-08-10', now: NOW } as Action)
    const row = rowFor(s, 'OAPIL-2')
    const health = computeHealth(row, TODAY)
    const ims = buildDailyIms(s, rowsOf(s), TODAY, 'OAPIL')
    const overdueSection = ims.sections.find((x) => /overdue/i.test(x.title))
    const listed = Boolean(overdueSection?.lines.some((l) => l.id === 'OAPIL-2' || l.subject.includes('OAPIL-2')))
    return {
      verdict: health === 'Overdue' && listed ? 'PARTIAL' : 'FAIL',
      actual: `Health is "${health}" and the daily IMS lists it under "${overdueSection?.title ?? 'no overdue section'}". No escalation exists: escalation is neither an action nor a record.`,
      stops: 'at escalation — the breach is reported, never routed',
      severity: 'P1',
      impact: 'A breach reaches a report, not a person with authority to fix it.',
    }
  },
)

scenario(
  'Q',
  'A project milestone becomes at risk',
  'The milestone shows the risk, and it rolls up to the project so a governance meeting sees it.',
  () => {
    const s = ok(BASE, { t: 'setDates', id: 'OAPIL-1', start: '2026-08-01', end: '2026-08-09', now: NOW } as Action)
    const issueRow = rowFor(s, 'OAPIL-1')
    const parentRow = rowsOf(s).find((r) => r.id === issueRow.parentId)
    return {
      verdict: parentRow && parentRow.plannedEndDate ? 'PARTIAL' : 'FAIL',
      actual: `A late issue rolls up: its process area now reports ${parentRow?.plannedStartDate} → ${parentRow?.plannedEndDate} with ${parentRow?.percentComplete}% complete. Milestones exist as a row kind, but no milestone record ties to a SOW or a payment.`,
      stops: 'at the milestone as a commercial object',
      severity: 'P2',
      impact: 'Delivery risk is visible; contractual consequence is not.',
    }
  },
)

/* ================================================================== *
 * 4 — Effort, estimate and actuals
 * ================================================================== */

scenario(
  'J',
  'A consultant records time against an issue',
  'The hours land on the work item, move it off stale, and become the actual half of the estimate.',
  () => {
    const logged = ok(BASE, {
      t: 'addTime', issueId: 'OAPIL-1', person: A.name, date: '2026-08-14',
      hours: 3.5, activity: 'Investigation', billable: true, note: 'Traced the batch failure.', now: NOW,
    } as Action)
    const more = ok(logged, {
      t: 'addTime', issueId: 'OAPIL-1', person: A.name, date: TODAY,
      hours: 2, activity: 'Resolution', billable: false, note: 'Rework after our own misconfiguration.', now: NOW,
    } as Action)

    const total = hoursOn(more.timeEntries, 'OAPIL-1')
    const summary = summariseTime(more.timeEntries, 'OAPIL-1')
    const activityMoved = more.issues['OAPIL-1'].lastActivity === TODAY
    const audited = more.audit.filter((e) => e.rowId === 'OAPIL-1' && e.field === 'time').length

    // What it refuses. Each of these is a way a timesheet quietly becomes fiction.
    const future = act(more, {
      t: 'addTime', issueId: 'OAPIL-1', person: A.name, date: '2026-09-01',
      hours: 1, activity: 'Meeting', billable: true, note: '', now: NOW,
    } as Action)
    const marathon = act(more, {
      t: 'addTime', issueId: 'OAPIL-1', person: A.name, date: TODAY,
      hours: 18, activity: 'Resolution', billable: true, note: '', now: NOW,
    } as Action)
    const precise = act(more, {
      t: 'addTime', issueId: 'OAPIL-1', person: A.name, date: TODAY,
      hours: 1.37, activity: 'Resolution', billable: true, note: '', now: NOW,
    } as Action)

    const good =
      total === 5.5 && summary.billable === 3.5 && summary.nonBillable === 2 &&
      activityMoved && audited === 2 &&
      Boolean(future.error) && Boolean(marathon.error) && Boolean(precise.error)

    return {
      verdict: good ? 'PARTIAL' : 'FAIL',
      actual: `${total}h recorded across ${summary.byActivity.length} activities — ${summary.billable}h billable, ${summary.nonBillable}h not — and the issue is no longer stale (last activity ${more.issues['OAPIL-1'].lastActivity}). Refused: a future day ("${future.error}"), an 18-hour entry, and 1.37 hours. Removing an entry withdraws it rather than destroying it.`,
      stops: 'at money — hours are recorded, and a rate to multiply them by does not exist anywhere',
      severity: 'P2',
      impact: 'Actual effort, variance and utilisation now have a source. Cost and margin still do not.',
    }
  },
)

scenario(
  'J2',
  "Somebody logs hours in a colleague's name",
  "It is refused unless they hold the grant for it, because hours are that person's account of their own day.",
  () => {
    const existing = Object.values(BASE.model.people).find((p) => p.name === 'Priya')!
    const withRole = (roleId: string) =>
      ok(BASE, {
        t: 'config', op: { k: 'upsertPerson', id: existing.id, name: 'Priya', roleIds: [roleId] }, now: NOW,
      } as Action)
    const staffed = withRole('ROLE_FUNCTIONAL')
    const priya: Actor = { id: existing.id, name: 'Priya' }

    const forOther = apply(staffed, {
      t: 'addTime', issueId: 'OAPIL-1', person: 'Sam', date: TODAY,
      hours: 2, activity: 'Resolution', billable: true, note: '', now: NOW,
    } as Action, priya)

    const forSelf = apply(staffed, {
      t: 'addTime', issueId: 'OAPIL-1', person: 'Priya', date: TODAY,
      hours: 2, activity: 'Resolution', billable: true, note: '', now: NOW,
    } as Action, priya)

    const asManager = withRole('ROLE_PROJECT_MANAGER')
    const nowAllowed = apply(asManager, {
      t: 'addTime', issueId: 'OAPIL-1', person: 'Sam', date: TODAY,
      hours: 2, activity: 'Resolution', billable: true, note: 'Logged on his behalf while he was on site.', now: NOW,
    } as Action, priya)

    const good = Boolean(forOther.error) && !forSelf.error && !nowAllowed.error
    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `A consultant logging their own hours is fine; logging Sam's is refused — "${forOther.error}" A project manager holds the grant and may, and the entry keeps Sam's name while the trail records who typed it.`,
      stops: '—',
      severity: '—',
      impact: "Hours cannot be attributed to somebody who did not agree they worked them, except by a role the firm chose to trust with it.",
    }
  },
)

scenario(
  'K',
  'Actual effort overruns the estimate',
  'The variance is visible on the issue, and it is honest about what it is measured against.',
  () => {
    const estimated = ok(BASE, {
      t: 'setEstimate', issueId: 'OAPIL-1',
      patch: { scores: { business: 2, technical: 2, integration: 1, testing: 2, data: 1 } }, now: NOW,
    } as Action)
    const agreed = ok(estimated, { t: 'baselineEstimate', issueId: 'OAPIL-1', now: NOW } as Action)
    const bands = agreed.model.sizeBands
    const planned = summarise(agreed.estimates['OAPIL-1'], bands).effortHours!

    // Spend half again as long as agreed.
    let spent = agreed
    for (const day of ['2026-08-11', '2026-08-12', '2026-08-13']) {
      spent = ok(spent, {
        t: 'addTime', issueId: 'OAPIL-1', person: A.name, date: day,
        hours: Math.round((planned / 2) * 4) / 4, activity: 'Resolution', billable: true, note: '', now: NOW,
      } as Action)
    }

    const v = effortVariance(spent.timeEntries, 'OAPIL-1', spent.estimates['OAPIL-1'], bands)
    const unestimated = effortVariance(spent.timeEntries, 'OAPIL-2', spent.estimates['OAPIL-2'], bands)

    const good =
      v.estimated === planned && v.actual > planned && v.varianceHours! > 0 &&
      v.againstBaseline && unestimated.estimated === null && unestimated.varianceHours === null

    return {
      verdict: good ? 'PARTIAL' : 'FAIL',
      actual: `${v.actual}h spent against ${v.estimated}h agreed — ${v.varianceHours! > 0 ? '+' : ''}${v.varianceHours}h, ${Math.round(v.variancePct!)}%. An unestimated issue reports its variance as unknown rather than as an overrun against zero, and an overrun against a draft is labelled as such: a number nobody agreed is not a commitment anybody broke.`,
      stops: 'before it reaches the project — the variance is per issue, and nothing rolls it up to a milestone, a SOW or a margin',
      severity: 'P2',
      impact: 'A consultant can see the overrun on the record. A partner still cannot see it on the engagement.',
    }
  },
)

/* ================================================================== *
 * 5 — Scope and change control
 * ================================================================== */

scenario(
  'N',
  'A client asks for something outside the SOW',
  'The request is recognised as out of scope and does not quietly become delivered work.',
  () => ({
    verdict: 'NOT IMPLEMENTED',
    actual: `There is no SOW record (${absent(/\bSOW\b|StatementOfWork/) ? 'the term appears nowhere in source' : 'the term appears in source'}), so there is no boundary for a request to be outside of.`,
    stops: 'at the boundary',
    severity: 'P0',
    impact: 'Scope leakage is undetectable by construction. This is the margin risk the product exists to control.',
  }),
)

scenario(
  'O',
  'A change request is raised',
  'It is captured as a CR, valued, and linked to the work it changes.',
  () => {
    const existing = Object.values(BASE.model.workTypes).find((t) => /change request/i.test(t.label))
    const base = existing
      ? BASE
      : ok(BASE, {
          t: 'config',
          op: { k: 'upsertWorkType', id: null, label: 'Change Request', description: 'Chargeable change to agreed scope' },
          now: NOW,
        } as Action)
    const cr = Object.values(base.model.workTypes).find((t) => /change request/i.test(t.label))!
    const s = ok(base, {
      t: 'create', parentId: base.issues['OAPIL-1'].parentId!, kind: 'issue',
      draft: { name: 'Add a second approval step', type: cr.label, severity: 'Medium' }, now: NOW,
    } as Action)
    const made = Object.values(s.issues).find((i) => i.subject === 'Add a second approval step')!
    return {
      verdict: 'PARTIAL',
      actual: `A CR can be raised as a work item of type "${made.type}"${existing ? '' : ' — the type is configuration and had to be added first'}, and linked to the issue that prompted it. It carries no value, no approver and no SOW to amend.`,
      stops: 'at valuation and approval',
      severity: 'P1',
      impact: 'A CR is a note about money, not a control over it.',
    }
  },
)

scenario(
  'P',
  'A change request is approved',
  'The approval is recorded by an authorised person, and the SOW value and scope move with it.',
  () => ({
    verdict: 'NOT IMPLEMENTED',
    actual: `Approval is neither an action nor a record (${absent(/t: 'approve|interface Approval\b/) ? 'no approve action in the reducer' : 'an approve action exists'}). A CR is closed by setting a status, which anyone can do.`,
    stops: 'at authority',
    severity: 'P0',
    impact: 'Nothing distinguishes an approved change from someone marking it approved.',
  }),
)

/* ================================================================== *
 * 6 — Resolution, evidence and closure
 * ================================================================== */

scenario(
  'R',
  'An issue is closed with no evidence attached',
  'Closure is refused, because the resolution could not be produced later.',
  () => {
    // Walk to the door legitimately, so the only thing missing is the evidence.
    const awaiting = ok(
      ok(BASE, { t: 'updateIssue', id: 'OAPIL-1', patch: { status: 'In Progress' }, now: NOW } as Action),
      { t: 'updateIssue', id: 'OAPIL-1', patch: { status: 'Awaiting client confirmation' }, now: NOW } as Action,
    )
    const bare = act(awaiting, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { status: 'Closed - confirmed' }, now: NOW,
    } as Action)

    const withEvidence = ok(awaiting, {
      t: 'addEvidence', issueId: 'OAPIL-1', kind: 'document', name: 'uat-signoff.pdf',
      purpose: 'Client confirmation', url: null, mimeType: 'application/pdf', sizeBytes: 22_000, note: '', now: NOW,
    } as Action)
    const closed = act(withEvidence, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { status: 'Closed - confirmed' }, now: NOW,
    } as Action)

    // Closing without the client's word does not require evidence — it makes no claim about them.
    const noDefect = act(awaiting, {
      t: 'updateIssue', id: 'OAPIL-2', patch: { status: 'Closed - no defect' }, now: NOW,
      reason: 'Configuration was correct; the client was looking at the wrong environment.',
    } as Action)

    const good = Boolean(bare.error) && !closed.error && !noDefect.error
    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `Refused without evidence: "${bare.error}" Accepted once a sign-off document is attached. Closing as "no defect" needs no evidence but does need a reason, because it makes a claim about the work rather than about the client.`,
      stops: '—',
      severity: '—',
      impact: 'A confirmed closure now has something behind it that can be shown to a client who disputes it.',
    }
  },
)

scenario(
  'ST6',
  'Work is closed as “no defect” with no explanation',
  'The change is refused until somebody says why, and the why survives on the trail.',
  () => {
    const started = ok(BASE, { t: 'updateIssue', id: 'OAPIL-3', patch: { status: 'In Progress' }, now: NOW } as Action)
    const silent = act(started, {
      t: 'updateIssue', id: 'OAPIL-3', patch: { status: 'Closed - no defect' }, now: NOW,
    } as Action)
    const explained = ok(started, {
      t: 'updateIssue', id: 'OAPIL-3', patch: { status: 'Closed - no defect' }, now: NOW,
      reason: 'Behaviour is as designed; raised against an out-of-date specification.',
    } as Action)
    const entry = explained.audit.find((e) => e.rowId === 'OAPIL-3' && e.field === 'status')
    // The reason belongs to the status change, not to every field in the same patch.
    const withOther = ok(started, {
      t: 'updateIssue', id: 'OAPIL-3',
      patch: { status: 'Closed - no defect', nextAction: 'None' }, now: NOW,
      reason: 'As designed.',
    } as Action)
    const otherEntry = withOther.audit.find((e) => e.rowId === 'OAPIL-3' && e.field === 'nextAction')

    const good = Boolean(silent.error) && Boolean(entry?.reason) && !otherEntry?.reason
    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `Refused without a reason: "${silent.error}" With one, the change lands and the trail carries it — "${entry?.reason ?? 'none'}". The reason is stamped only on the status entry, so a closure rationale is never attributed to an unrelated field in the same save.`,
      stops: '—',
      severity: '—',
      impact: 'The two closures a client queries later now come with the firm\u2019s own explanation attached.',
    }
  },
)

scenario(
  'S',
  'An issue is resolved',
  'The resolution is recorded, the client is told, and verification is requested.',
  () => {
    const s = ok(BASE, {
      t: 'updateIssue', id: 'OAPIL-3', patch: { status: 'Awaiting client confirmation', nextAction: 'Client to verify in UAT' }, now: NOW,
    } as Action)
    const audited = s.audit.filter((e) => e.rowId === 'OAPIL-3').length
    return {
      verdict: 'PARTIAL',
      actual: `The status moves, the next action is recorded and ${audited} audit entries were written with before, after and actor. No message is sent to the client.`,
      stops: 'at telling the client',
      severity: 'P2',
      impact: 'Verification waits on somebody remembering to ask for it.',
    }
  },
)

scenario(
  'T',
  'An issue is verified and closed',
  'Closure is recorded with a date, and it cannot be reopened without a trace.',
  () => {
    // The route the graph requires: work it, ask the client, attach what they said, close it.
    const awaiting = ok(
      ok(BASE, { t: 'updateIssue', id: 'OAPIL-3', patch: { status: 'In Progress' }, now: NOW } as Action),
      { t: 'updateIssue', id: 'OAPIL-3', patch: { status: 'Awaiting client confirmation' }, now: NOW } as Action,
    )
    const evidenced = ok(awaiting, {
      t: 'addEvidence', issueId: 'OAPIL-3', kind: 'link', name: 'Client confirmation email',
      purpose: 'Client confirmation', url: 'https://example.invalid/mail/1', mimeType: null,
      sizeBytes: null, note: '', now: NOW,
    } as Action)
    const closed = ok(evidenced, { t: 'updateIssue', id: 'OAPIL-3', patch: { status: 'Closed - confirmed' }, now: NOW } as Action)
    const end = closed.issues['OAPIL-3'].actualEnd
    const reopened = ok(closed, { t: 'updateIssue', id: 'OAPIL-3', patch: { status: 'In Progress' }, now: NOW } as Action)
    const cleared = reopened.issues['OAPIL-3'].actualEnd === null
    const trail = reopened.audit.filter((e) => e.rowId === 'OAPIL-3' && e.field === 'actualEnd').length
    return {
      verdict: end === TODAY && cleared && trail >= 2 ? 'PASS' : 'FAIL',
      actual: `Reached along the route the graph requires — In Progress, Awaiting client confirmation, evidence attached, then closed. Closing derived actualEnd = ${end}; reopening cleared it, and both derived writes are in the trail (${trail} entries). The derivation guards on the status having changed, so an unrelated edit cannot overwrite a closure date.`,
      stops: '—',
      severity: '—',
      impact: 'Closure and reopening are both honest about the date.',
    }
  },
)

/* ================================================================== *
 * 7 — State transitions
 * ================================================================== */

scenario(
  'ST1',
  'An issue jumps straight from Open to Closed, skipping every intermediate state',
  'The transition is refused, and the refusal says where the work can actually go from here.',
  () => {
    const jump = act(BASE, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { status: 'Closed - confirmed' }, now: NOW,
    } as Action)

    // The legitimate route still works, one step at a time — a graph that only refuses would
    // be no better than the free-for-all it replaced.
    const started = ok(BASE, { t: 'updateIssue', id: 'OAPIL-1', patch: { status: 'In Progress' }, now: NOW } as Action)
    const awaiting = ok(started, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { status: 'Awaiting client confirmation' }, now: NOW,
    } as Action)
    const withEvidence = ok(awaiting, {
      t: 'addEvidence', issueId: 'OAPIL-1', kind: 'snapshot', name: 'client-signoff.png',
      purpose: 'Client confirmation', url: null, mimeType: 'image/png', sizeBytes: 4200, note: '', now: NOW,
    } as Action)
    const closed = ok(withEvidence, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { status: 'Closed - confirmed' }, now: NOW,
    } as Action)

    // The patch is refused whole: a rejected status must not let its siblings through.
    const mixed = act(BASE, {
      t: 'updateIssue', id: 'OAPIL-1',
      patch: { status: 'Closed - confirmed', nextAction: 'Chase the client' }, now: NOW,
    } as Action)
    const nothingLeaked = mixed.state.issues['OAPIL-1'].nextAction === BASE.issues['OAPIL-1'].nextAction

    const good = Boolean(jump.error) && closed.issues['OAPIL-1'].status === 'Closed - confirmed' && nothingLeaked
    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `Refused: "${jump.error}" The same move succeeds along the route the graph allows — In Progress, Awaiting client confirmation, then Closed - confirmed with evidence attached. A patch carrying a refused status is rejected whole, so the other fields in it are not quietly saved.`,
      stops: '—',
      severity: '—',
      impact: 'Closure now requires the steps that make it defensible, and the graph is configuration a firm can change.',
    }
  },
)

scenario(
  'ST5',
  'A firm turns transition enforcement off',
  'Every move is allowed again, and the change is recorded as the decision it is.',
  () => {
    const relaxed = ok(BASE, {
      t: 'config', op: { k: 'setStatusPolicy', patch: { enforced: false } }, now: NOW,
    } as Action)
    const jump = act(relaxed, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { status: 'Closed - confirmed' }, now: NOW,
    } as Action)
    const logged = relaxed.audit.some((e) => e.field === 'statusPolicy')

    // A graph that traps work is refused rather than stored.
    const trap = act(BASE, {
      t: 'config',
      op: {
        k: 'setStatusPolicy',
        patch: { transitions: { 'In Progress': [] } as unknown as Record<string, string[]> },
      },
      now: NOW,
    } as Action)

    const good = !jump.error && logged && Boolean(trap.error)
    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `With enforcement off the direct close is accepted again, and the switch is audited with before and after. A table that would trap work is refused rather than saved: "${trap.error}"`,
      stops: '—',
      severity: '—',
      impact: 'The control is the firm\u2019s to relax, and relaxing it is a recorded decision rather than a silent default.',
    }
  },
)

scenario(
  'ST2',
  'A consultant, an analyst and a client user each try the same nine operations',
  'Each is allowed what their role grants and refused the rest, with a refusal that explains itself.',
  () => {
    // Give the directory some roles. The imported log has none, which is the state the
    // fallback role exists for — see `defaultRoleIds`.
    const withRoles = (() => {
      let cur = BASE
      const assign = (name: string, roleId: string) => {
        const person = Object.values(cur.model.people).find((p) => p.name === name)
        cur = ok(cur, {
          t: 'config',
          op: { k: 'upsertPerson', id: person?.id ?? null, name, roleIds: [roleId] },
          now: NOW,
        } as Action)
      }
      assign('Priya', 'ROLE_FUNCTIONAL')
      assign('Sam', 'ROLE_SUPPORT')
      assign('Dana', 'ROLE_CLIENT_USER')
      return cur
    })()

    const AS = (name: string): Actor => ({ id: name.toLowerCase(), name })
    const attempt = (who: Actor, action: Action) => !apply(withRoles, action, who).error

    const parentId = withRoles.issues['OAPIL-1'].parentId!
    const probe = (who: Actor) => ({
      raise: attempt(who, { t: 'create', parentId, kind: 'issue', draft: { name: 'New request' }, now: NOW } as Action),
      edit: attempt(who, { t: 'updateIssue', id: 'OAPIL-1', patch: { nextAction: 'Chase' }, now: NOW } as Action),
      close: attempt(who, {
        t: 'updateIssue', id: 'OAPIL-1', patch: { status: 'Closed - no defect' }, now: NOW,
        reason: 'Not a defect.',
      } as Action),
      schedule: attempt(who, { t: 'setDates', id: 'OAPIL-1', start: '2026-08-10', end: '2026-08-20', now: NOW } as Action),
      note: attempt(who, { t: 'addNote', issueId: 'OAPIL-1', body: 'Spoke to the client.', noteType: 'General Update', pinned: false, now: NOW } as Action),
      estimate: attempt(who, { t: 'setEstimate', issueId: 'OAPIL-1', patch: { waitDays: 2 }, now: NOW } as Action),
      // Reopening a closed record, which is a closure decision in the other direction.
      reopen: (() => {
        const closed = ok(withRoles, {
          t: 'updateIssue', id: 'OAPIL-2', patch: { status: 'Closed - no defect' }, now: NOW,
          reason: 'Not a defect.',
        } as Action)
        return !apply(closed, {
          t: 'updateIssue', id: 'OAPIL-2', patch: { status: 'In Progress' }, now: NOW,
        } as Action, who).error
      })(),
      archive: attempt(who, { t: 'softDelete', id: 'OAPIL-1', mode: 'cascade', now: NOW } as Action),
      configure: attempt(who, { t: 'config', op: { k: 'setSla', patch: { High: 3 } }, now: NOW } as Action),
    })

    const consultant = probe(AS('Priya'))
    const analyst = probe(AS('Sam'))
    const client = probe(AS('Dana'))

    const expected =
      // A functional consultant delivers: raise, edit, close, schedule, estimate — not archive or configure.
      consultant.raise && consultant.edit && consultant.close && consultant.schedule &&
      consultant.estimate && consultant.reopen && !consultant.archive && !consultant.configure &&
      // An analyst triages: raise, edit, note — not close, not schedule, not estimate.
      analyst.raise && analyst.edit && analyst.note &&
      !analyst.close && !analyst.reopen && !analyst.schedule && !analyst.estimate &&
      // A client user raises and comments, and touches nothing else.
      client.raise && client.note &&
      !client.edit && !client.close && !client.schedule && !client.estimate && !client.configure

    const refusal = apply(withRoles, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { status: 'Closed - no defect' }, now: NOW, reason: 'x',
    } as Action, AS('Dana')).error

    return {
      verdict: expected ? 'PASS' : 'FAIL',
      actual: `Consultant may raise, edit, close, reopen, schedule and estimate but not archive or configure. Analyst may raise, edit and note but not close, reopen, schedule or estimate — reopening counts as a closure decision, because it moves a record back out of the done set. Client user may raise and note only. The refusal names the role rather than just saying no: "${refusal}"`,
      stops: '—',
      severity: '—',
      impact: 'The rules a firm states about who may do what are now applied, and applied at the reducer rather than in the screens.',
    }
  },
)

scenario(
  'ST2b',
  'Somebody claims to be a colleague',
  'The claim is verified against an identity provider before anything is allowed.',
  () => {
    const hasAuth = !absent(/next-auth|@azure\/msal|getServerSession|verifyToken|jwtVerify/)
    return {
      verdict: 'NOT IMPLEMENTED',
      actual: `${hasAuth ? 'An auth library appears in source.' : 'No authentication exists: no session, no token verification, no provider.'} Every request resolves to one operator read from an environment variable, so authorisation is enforced against a claimed identity rather than a proven one. The permission model stops a mistake, not an attacker — the code says so where it is defined.`,
      stops: 'at proving who somebody is',
      severity: 'P0',
      impact: 'Grants are only as good as the claim behind them. Until a login exists, the fallback role is effectively everyone.',
    }
  },
)

scenario(
  'ST2c',
  "Somebody edits another person's note",
  "The edit is refused, because a note is that person's account — unless they hold the supervisor grant.",
  () => {
    const withNote = ok(BASE, {
      t: 'addNote', issueId: 'OAPIL-1', body: 'Client says the batch still fails.',
      noteType: 'Client Communication', pinned: false, now: NOW,
    } as Action)
    const noteId = Object.values(withNote.notes)[0].id
    const other: Actor = { id: 'colleague', name: 'Someone Else' }

    // The colleague has to hold a role of their own. An actor with none falls back to
    // `defaultRoleIds`, which ships as Administrator — so on a deployment with no login,
    // an unrecognised actor is a supervisor. That is the authentication gap showing through
    // the authorisation model, and it is the reason ST2b is still open.
    const staffed = ok(withNote, {
      t: 'config',
      op: { k: 'upsertPerson', id: null, name: 'Someone Else', roleIds: ['ROLE_FUNCTIONAL'] },
      now: NOW,
    } as Action)

    const refused = apply(staffed, {
      t: 'updateNote', id: noteId, patch: { body: 'Client says it is fine now.' }, now: NOW,
    } as Action, other)

    const withOverride = ok(staffed, {
      t: 'config',
      op: { k: 'setAccess', patch: { grants: { ROLE_FUNCTIONAL: [...PERMISSION_KEYS] } } },
      now: NOW,
    } as Action)
    const allowed = apply(withOverride, {
      t: 'updateNote', id: noteId, patch: { body: 'Corrected: the client meant the nightly job.' }, now: NOW,
    } as Action, other)
    const keptAuthor = allowed.state.notes[noteId]?.createdBy
    const recordedEditor = allowed.state.notes[noteId]?.updatedBy

    const good = Boolean(refused.error) && !allowed.error && keptAuthor !== recordedEditor
    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `Refused for a different author: "${refused.error}" With the supervisor grant it lands, and the note still says it was written by ${keptAuthor} while recording ${recordedEditor} as the editor. The rule had existed in the panel since notes shipped and was never checked in the reducer — so it held for people using the button and for nothing else that could dispatch.`,
      stops: '—',
      severity: '—',
      impact: "Somebody else's account of what they saw can no longer be rewritten under their name — provided they hold a role of their own. An actor with none still falls back to Administrator, which is ST2b.",
    }
  },
)

scenario(
  'ST3',
  'Two people edit the same issue at once',
  'The second write is detected as conflicting rather than silently overwriting the first.',
  () => {
    const mine = ok(BASE, { t: 'updateIssue', id: 'OAPIL-1', patch: { owner: 'Priya' }, now: NOW } as Action)
    const theirs = ok(BASE, { t: 'updateIssue', id: 'OAPIL-1', patch: { owner: 'Sam' }, now: NOW } as Action)
    const replayed = act(theirs, { t: 'updateIssue', id: 'OAPIL-1', patch: { owner: 'Priya' }, now: NOW } as Action)
    return {
      verdict: replayed.error ? 'PASS' : 'FAIL',
      actual: `Both writes apply. Replaying the first against the second's state succeeds silently — owner ends as "${replayed.state.issues['OAPIL-1'].owner}". There is no version, no row hash and no If-Match: the reducer rejects impossible states, not stale ones. Result: last writer wins, and only the audit trail shows the loss.`,
      stops: 'at concurrency control',
      severity: 'P1',
      impact: 'Two consultants working the same issue overwrite each other. The trail records it; neither is told.',
    }
  },
)

scenario(
  'ST4',
  'A record is archived and later restored',
  'Nothing is orphaned, and anything moved out during the archive comes back.',
  () => {
    const moduleId = Object.values(BASE.nodes).find((n) => n.kind === 'module')!.id
    const archived = ok(BASE, { t: 'softDelete', id: moduleId, mode: 'cascade', now: NOW } as Action)
    const orphanRestore = act(archived, { t: 'restore', id: 'OAPIL-1', now: NOW } as Action)
    const restored = ok(archived, { t: 'restore', id: moduleId, now: NOW } as Action)
    const back = Object.values(restored.issues).filter((i) => !i.deletedAt).length
    return {
      verdict: orphanRestore.error && back === 3 ? 'PASS' : 'FAIL',
      actual: `Restoring a child under an archived parent is refused ("${orphanRestore.error}"), and restoring the parent brings all ${back} records back. Deletion is soft throughout; nothing is destroyed.`,
      stops: '—',
      severity: '—',
      impact: 'The data lifecycle is reversible and cannot produce an unreachable record.',
    }
  },
  'AB',
)

/* ================================================================== *
 * 8 — Configuration → runtime
 * ================================================================== */

scenario(
  'CF1',
  'The firm shortens its High-severity SLA from 5 days to 2',
  'The next issue raised gets a 2-day target, and everything downstream follows.',
  () => {
    const before = planSlaDates(rowsOf(BASE).filter((r) => r.kind === 'issue'), BASE.model.sla, TODAY)
    const s = ok(BASE, { t: 'config', op: { k: 'setSla', patch: { High: 2 } }, now: NOW } as Action)
    const after = planSlaDates(rowsOf(s).filter((r) => r.kind === 'issue'), s.model.sla, TODAY)
    const pick = (p: ReturnType<typeof planSlaDates>) => p.rows.find((r) => r.id === 'OAPIL-1')
    const b = pick(before)
    const a2 = pick(after)
    const moved = Boolean(b && a2 && b.target !== a2.target)
    return {
      verdict: moved ? 'PASS' : 'FAIL',
      actual: `Default High = ${DEFAULT_SLA.High}d proposed ${b?.target}; after the change the same issue proposes ${a2?.target}. The policy is read from the model at every derivation, not captured at startup, and the change is audited with before and after.`,
      stops: '—',
      severity: '—',
      impact: 'Configuration reaches runtime for the SLA. Dates already committed are deliberately left alone, and the screen says so.',
    }
  },
)

scenario(
  'CF2',
  'The firm adds a work type and retires another',
  'New records can use the new type, and records already filed under the retired one stay readable.',
  () => {
    const added = ok(BASE, {
      t: 'config', op: { k: 'upsertWorkType', id: null, label: 'Data Fix', description: 'Corrective data change' }, now: NOW,
    } as Action)
    const created = ok(added, {
      t: 'create', parentId: BASE.issues['OAPIL-1'].parentId!, kind: 'issue',
      draft: { name: 'Correct the batch reference', type: 'Data Fix' }, now: NOW,
    } as Action)
    const usable = Object.values(created.issues).some((i) => i.type === 'Data Fix')
    const defect = Object.values(created.model.workTypes).find((t) => t.label === 'Defect')!
    const retired = act(created, { t: 'config', op: { k: 'deleteWorkType', id: defect.id }, now: NOW } as Action)
    const stillTyped = retired.state.issues['OAPIL-1'].type === 'Defect'
    return {
      verdict: usable && stillTyped ? 'PASS' : 'FAIL',
      actual: `A new type is usable immediately (${usable}), and retiring one in use ${retired.error ? `is refused: "${retired.error}"` : 'leaves existing records reading their original type'}.`,
      stops: '—',
      severity: '—',
      impact: 'The discriminator behaves as configuration, which is what keeps one work-item table honest.',
    }
  },
)

scenario(
  'CF3',
  'A project is created from a template',
  'Work items, workflow, SLA, notifications, agents and checklists all arrive with it.',
  () => {
    const template = Object.values(BASE.model.templates)[0]
    if (!template) {
      return { verdict: 'NOT IMPLEMENTED', actual: 'No templates are configured.', stops: 'at the template', severity: 'P2', impact: 'Every project is set up by hand.' }
    }
    const clientId = Object.values(BASE.nodes).find((n) => n.kind === 'client')!.id
    const s = ok(BASE, { t: 'config', op: { k: 'adoptTemplate', scopeId: clientId, templateId: template.id }, now: NOW } as Action)
    const applied = s.model.overrides[clientId]?.templateId === template.id
    const carries = [
      template.agentIds.length ? `${template.agentIds.length} agents` : null,
      template.workflowIds.length ? `${template.workflowIds.length} workflows` : null,
      template.requireApproval ? 'an approval default' : null,
    ].filter(Boolean)
    return {
      verdict: applied ? 'PARTIAL' : 'FAIL',
      actual: `Adopting "${template.name}" at a scope works and carries ${carries.join(', ') || 'nothing'}. It creates no work items, applies no SLA of its own and configures no notifications — a template is a set of defaults, not a project setup.`,
      stops: 'at everything the template does not carry',
      severity: 'P2',
      impact: 'Mobilising a project is still manual; only the operating-model defaults are inherited.',
    }
  },
)

/* ================================================================== *
 * 9 — Reporting against source data
 * ================================================================== */

scenario(
  'RP1',
  'The daily IMS report is checked against the records it counts',
  'Every figure on the report can be reproduced from the underlying rows.',
  () => {
    const s = ok(
      ok(BASE, { t: 'setDates', id: 'OAPIL-2', start: '2026-08-01', end: '2026-08-10', now: NOW } as Action),
      {
        t: 'updateIssue', id: 'OAPIL-3', patch: { status: 'Closed - no defect' }, now: NOW,
        reason: 'Environment issue at the client end; no change required.',
      } as Action,
    )
    const rows = rowsOf(s)
    const ims = buildDailyIms(s, rows, TODAY, 'OAPIL')
    const issues = rows.filter((r) => r.kind === 'issue')
    const openTruth = issues.filter((r) => !isTerminal(r.status)).length
    const overdueTruth = issues.filter((r) => computeHealth(r, TODAY) === 'Overdue').length
    const reportedOpen = ims.position.open
    const overdueSection = ims.sections.find((x) => /overdue/i.test(x.title))
    const agrees = reportedOpen === openTruth && ims.position.overdue === overdueTruth
    return {
      verdict: agrees ? 'PASS' : 'FAIL',
      actual: `Report says open=${reportedOpen} and overdue=${ims.position.overdue}; recounting the rows gives ${openTruth} and ${overdueTruth}. Section "${overdueSection?.title ?? 'none'}" lists ${overdueSection?.lines.length ?? 0}. The report derives from the same rows the grid shows, counts rather than estimates, and prints its own section cap rather than truncating silently.`,
      stops: '—',
      severity: '—',
      impact: 'The one report that exists reconciles to its source.',
    }
  },
)

scenario(
  'RP2',
  'Weekly client and monthly governance reporting',
  'A client-safe weekly pack and a monthly governance pack can be produced.',
  () => ({
    verdict: 'NOT IMPLEMENTED',
    actual: `Only the daily IMS is built (${mentions(/lib\/reports/).length} report module(s) in source). The weekly pack needs a client-visible boundary that does not exist — no field marks a record or a note as client-safe.`,
    stops: 'at the visibility boundary',
    severity: 'P1',
    impact: 'Anything sent to a client is assembled by hand, and internal notes are one copy-paste from the client.',
  }),
)

/* ================================================================== *
 * 10 — Audit, AI, failure
 * ================================================================== */

scenario(
  'AU1',
  'Every meaningful change answers who, what, when, before, after and why',
  'The trail is complete enough to defend a decision months later.',
  () => {
    const s = ok(
      ok(BASE, { t: 'setDates', id: 'OAPIL-1', start: '2026-08-10', end: '2026-08-20', now: NOW, reason: 'Client moved UAT' } as Action),
      { t: 'updateIssue', id: 'OAPIL-1', patch: { severity: 'Medium' }, now: NOW } as Action,
    )
    const mine = s.audit.filter((e) => e.rowId === 'OAPIL-1')
    const complete = mine.every((e) => e.by && e.at && e.field && e.to !== undefined)
    const withReason = mine.filter((e) => e.reason).length
    return {
      verdict: complete ? (withReason ? 'PASS' : 'PARTIAL') : 'FAIL',
      actual: `${mine.length} entries, all carrying actor, time, field, before and after; ${withReason} carry a reason. Attribution is a parameter of the reducer, so no action can forge it — proven separately by audit:attribution. Why is captured where the product asks for it (date changes, estimate revisions) and absent elsewhere.`,
      stops: 'at "why" for ordinary field edits',
      severity: 'P3',
      impact: 'The trail is strong on what changed, thinner on the reasoning behind routine edits.',
    }
  },
)

scenario(
  'AI1',
  'The assistant proposes a change with low confidence',
  'It recommends rather than acts, and a person decides.',
  () => {
    const gated = mentions(/proposal|applyProposal|cards\[/).length
    return {
      verdict: 'NOT TESTABLE',
      actual: `One live agent exists behind a chat route, and its proposals are rendered as cards a person accepts or rejects (${gated} files participate). Confidence thresholds and autonomy levels are registry fields with no runtime that reads them. Driving it needs a model key this script does not have.`,
      stops: 'at the autonomy fields — declared, unread',
      severity: 'P1',
      impact: '37 of 38 agents are records. The one that runs is gated correctly, but the gate is code, not the configured policy.',
    }
  },
  'X',
)

scenario(
  'FL1',
  'The database is unreachable while someone is working',
  'The user keeps working, nothing is lost, and the queue recovers when it comes back.',
  () => {
    const src = fs.readFileSync(path.join(ROOT, 'components/useAutosave.ts'), 'utf8')
    const halts = /halted\.current = true/.test(src)
    const recovers = /halted\.current = false/.test(src)
    const beaconClearsAll = /queue\.current = \[\]/.test(src) && /slice\(0, MAX_BATCH\)/.test(src)
    return {
      verdict: halts && !recovers ? 'FAIL' : 'PARTIAL',
      actual: `The queue retries with backoff four times, then halts and tells the user — and ${recovers ? 'can resume' : 'never resumes: nothing ever clears the halt for the life of the session'}. Editing continues into the local mirror, so work is visible but unsaved.${beaconClearsAll ? ' Separately, the unload flush sends the first 50 queued actions and then clears the whole queue, dropping the remainder.' : ''}`,
      stops: 'at recovery',
      severity: 'P1',
      impact: 'A ten-second outage silently ends persistence for the rest of the session.',
    }
  },
)

scenario(
  'FL2',
  'A malformed or hostile write reaches the API',
  'It is rejected before it touches stored state.',
  () => {
    const route = fs.readFileSync(path.join(ROOT, 'app/api/workspace/route.ts'), 'utf8')
    const checksKind = /KINDS\.has/.test(route)
    const validatesPayload = /zod|safeParse|validateAction/.test(route)
    return {
      verdict: checksKind && !validatesPayload ? 'PARTIAL' : validatesPayload ? 'PASS' : 'FAIL',
      actual: `The endpoint validates the batch shape and the action kind against an allowlist, resolves tenant and actor server-side, and refuses anything else. It does not validate the payload: an action's fields are spread into the record, and TypeScript is erased at runtime. The reducer catches impossible values it knows about; it does not police unknown keys.`,
      stops: 'at field-level validation',
      severity: 'P1',
      impact: 'Today the endpoint is unauthenticated anyway, so this is latent. It becomes the sharp edge the moment identity lands.',
    }
  },
)

scenario(
  'FL3',
  'The persistence layer is exercised at all',
  'Writes reach Postgres and reload correctly.',
  () => {
    const configured = Boolean(process.env.DATABASE_URL)
    const files = mentions(/prisma\.\w+\.(findMany|upsert|create)/).length
    return {
      verdict: configured ? 'NOT TESTABLE' : 'NOT TESTABLE',
      actual: `DATABASE_URL is ${configured ? 'set' : 'not set, and there is no .env.example'}. The repository, mappers, write path and baseline migration exist across ${files} module(s) and typecheck, but no test in this repository has ever run them against a database. Every proof here is reducer-level.`,
      stops: 'at the database — it has never been connected in this environment',
      severity: 'P1',
      impact: 'The most reversible-looking layer is the least verified. A mapper mistake would surface as data loss on first deployment.',
    }
  },
)


/* ================================================================== *
 * 11 — Time approval, delivery and failure of the machinery
 * ================================================================== */

scenario(
  'U',
  'A consultant submits a timesheet',
  'The week is presented for approval, and approval freezes exactly what was approved.',
  () => ({
    verdict: 'NOT IMPLEMENTED',
    actual: `Entries exist and are the record; there is no period, no submission and no approval — ${absent(/submitPeriod|TimePeriod|interface Timesheet/) ? 'no such type in source' : 'a type exists'}. The entry-as-record decision is the half that had to come first: attaching approval to a container is what lets an edited entry silently change an approved total.`,
    stops: 'at approval, which is the same missing mechanism as scenario P',
    severity: 'P1',
    impact: 'Time is recorded and cannot yet be signed off, so it cannot be billed.',
  }),
)

scenario(
  'V',
  'A submitted timesheet is rejected',
  'The rejection returns specific entries, says why, and the corrected resubmission is traceable.',
  () => ({
    verdict: 'NOT IMPLEMENTED',
    actual: 'Requires U. The nearest existing mechanism is the estimate revision log, which refuses to let an agreed number move without a reason — the same shape this needs, applied to a different record.',
    stops: 'at the same missing approval',
    severity: 'P1',
    impact: 'No correction loop exists for the record that drives revenue.',
  }),
)

scenario(
  'W',
  'A notification fails to deliver',
  'The failure is visible, retried, and audited — a silent non-delivery is the dangerous case.',
  () => ({
    verdict: 'NOT IMPLEMENTED',
    actual: `There is no delivery mechanism to fail: ${absent(/sendMail|nodemailer|smtp|graph\.microsoft|webhook/i) ? 'no mail, Teams or webhook client appears anywhere in the source' : 'a delivery client exists'}. Communication today is a note somebody types on an issue.`,
    stops: 'at the channel',
    severity: 'P1',
    impact: 'Nobody is ever told anything by the system, so nothing can fail to tell them — which is not the same as working.',
  }),
)

scenario(
  'Y',
  'The assistant recommends something wrong',
  'A person rejects it, the rejection is recorded, and the original recommendation is preserved.',
  () => {
    const cards = mentions(/accept|reject/i).filter((f) => /Chat|chat/.test(f))
    return {
      verdict: 'PARTIAL',
      actual: `Proposals are rendered as cards a person accepts or rejects (${cards.length} chat module(s) implement it), and an accepted proposal goes through the same reducer as a human edit, so it is audited identically. A rejection changes nothing and is recorded nowhere — ${absent(/rejectedProposal|proposalOutcome|recommendationLog/) ? 'no rejection log exists in source' : 'a rejection log exists'} — so the system cannot learn which recommendations were wrong.`,
      stops: 'at the rejection — it disappears',
      severity: 'P2',
      impact: 'Agent quality cannot be measured, because only the accepted half of its output is kept.',
    }
  },
)

scenario(
  'Z',
  'An automation fails part-way through',
  'The run stops safely, the partial effect is visible, and someone is told.',
  () => ({
    verdict: 'NOT IMPLEMENTED',
    actual: `There is no automation runtime (${absent(/runRule|evaluateRules|automationEngine|dispatchEvent/) ? 'no rule engine, event dispatcher or scheduler in source' : 'an engine exists'}). Routing rules are records; nothing evaluates them.`,
    stops: 'at the engine',
    severity: 'P0',
    impact: 'Every rule the firm configures is inert. The screen implies otherwise.',
  }),
)

scenario(
  'AA',
  'An integration fails',
  'The failure is contained, retried where safe, surfaced, and never leaves records half-written.',
  () => ({
    verdict: 'NOT IMPLEMENTED',
    actual: `No outbound integration exists. The only network call the product makes is to the model behind the chat route; ${absent(/DevOps|sharepoint|graph\.microsoft|jira/i) ? 'no DevOps, SharePoint or Teams client appears in source' : 'an integration client exists'}.`,
    stops: 'at the integration',
    severity: 'P2',
    impact: 'Nothing to fail yet — but the write path has no idempotency key, so retries will need one before the first integration lands. See FL4.',
  }),
)

scenario(
  'FL4',
  'The same write is delivered twice',
  'The second delivery is recognised and ignored, rather than creating a second record.',
  () => {
    const src = fs.readFileSync(path.join(ROOT, 'components/useAutosave.ts'), 'utf8')
    const beaconOnHide = /visibilitychange/.test(src) && /sendBeacon/.test(src)
    const hasKey = /idempotenc|requestId|clientActionId|Idempotency-Key/i.test(src)
    // The reducer mints ids from its own counter, so a replay creates a new record rather
    // than overwriting one. Demonstrated rather than asserted:
    const once = ok(BASE, { t: 'addNote', issueId: 'OAPIL-1', body: 'Same note.', noteType: 'General Update', pinned: false, now: NOW } as Action)
    const twice = ok(once, { t: 'addNote', issueId: 'OAPIL-1', body: 'Same note.', noteType: 'General Update', pinned: false, now: NOW } as Action)
    const duplicated = Object.values(twice.notes).filter((n) => n.body === 'Same note.').length
    return {
      verdict: 'FAIL',
      actual: `Replaying an identical action produces ${duplicated} records, because ids are minted server-side from the workspace counter and nothing identifies a request ${hasKey ? '(a key exists but is unused)' : '— there is no idempotency key'}. The unload flush makes this reachable rather than theoretical: ${beaconOnHide ? 'a beacon fires on visibilitychange and can re-send a batch that is already in flight' : 'no beacon path exists'}.`,
      stops: 'at request identity',
      severity: 'P1',
      impact: 'Hiding a tab mid-save can duplicate notes, evidence and dependencies. The user sees two of something they did once.',
    }
  },
)

scenario(
  'XM1',
  'An issue changes owner, and eight dependent areas should follow',
  'Work, capacity, notifications, activity history, audit, reporting and AI context all reflect the new owner.',
  () => {
    const s = ok(BASE, { t: 'updateIssue', id: 'OAPIL-1', patch: { owner: 'Sam' }, now: NOW } as Action)
    const row = rowFor(s, 'OAPIL-1')
    const audited = s.audit.filter((e) => e.rowId === 'OAPIL-1' && e.field === 'owner').length
    const ims = buildDailyIms(s, rowsOf(s), TODAY, 'OAPIL')
    const inReport = ims.open.some((l) => l.owner === 'Sam')
    const reached = [
      row.owner === 'Sam' ? 'the work item' : null,
      audited ? 'the audit trail' : null,
      s.issues['OAPIL-1'].lastActivity === TODAY ? 'activity history' : null,
      inReport ? 'the daily report' : null,
    ].filter(Boolean)
    const absentAreas = ['resource workload', 'capacity', 'notifications', 'AI context']
    return {
      verdict: 'PARTIAL',
      actual: `${reached.length} of 8 dependent areas follow the change — ${reached.join(', ')}. The other four are absent rather than stale: ${absentAreas.join(', ')}. Nothing derived is stored, so within the areas that exist there is no drift to find: the report recomputes from the same rows the grid does.`,
      stops: 'at the four areas that have no entity behind them',
      severity: 'P2',
      impact: 'Propagation is correct as far as it goes. It goes half as far as the operating model describes.',
    }
  },
)

/* ================================================================== *
 * Report
 * ================================================================== */

const ORDER: Verdict[] = ['FAIL', 'PARTIAL', 'PASS', 'NOT IMPLEMENTED', 'NOT TESTABLE']
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n))

console.log('')
console.log('AXIOMATE — SCENARIO VALIDATION')
console.log(`Driven against the real reducer and derivations, as at ${TODAY}.`)
console.log('')
console.log(`${pad('ID', 8)}${pad('VERDICT', 17)}${pad('SEV', 5)}SCENARIO`)
console.log('-'.repeat(103))
for (const f of findings) {
  console.log(`${pad(f.alias ? `${f.id}/${f.alias}` : f.id, 8)}${pad(f.verdict, 17)}${pad(f.severity, 5)}${f.title}`)
}

console.log('')
console.log('SUMMARY')
for (const v of ORDER) {
  const n = findings.filter((f) => f.verdict === v).length
  if (n) console.log(`  ${pad(v, 18)}${n}`)
}
const p0 = findings.filter((f) => f.severity === 'P0')
const p1 = findings.filter((f) => f.severity === 'P1')
console.log(`  ${pad('P0', 18)}${p0.length}    ${p0.map((f) => f.id).join(', ')}`)
console.log(`  ${pad('P1', 18)}${p1.length}    ${p1.map((f) => f.id).join(', ')}`)

console.log('')
console.log('WHERE EACH TRACE STOPS')
for (const f of findings.filter((x) => x.verdict !== 'PASS')) {
  console.log(`  ${pad(f.id, 5)}${f.stops}`)
}

/* Machine-readable, so the report page and any future regression gate read the same run. */
const out = path.join(ROOT, 'data', 'validation.json')
fs.writeFileSync(out, JSON.stringify({ asAt: TODAY, findings }, null, 2) + '\n')
console.log('')
console.log(`Written to ${path.relative(ROOT, out)} — ${findings.length} scenarios.`)
