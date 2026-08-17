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
import {
  apply,
  applyWithRules,
  initWorkspace,
  runWatch,
  type Action,
  type SeedIssueInput,
  type WorkspaceState,
} from '../lib/workspace'
import { undelivered } from '../lib/notifications'
import { describePosition, sowPosition } from '../lib/sow'
import { capacityFor, planCheck } from '../lib/capacity'
import { rolesFor } from '../lib/access'
import { SCHEDULE_ACTOR } from '../lib/actor'
import { EMPTY_OBSERVATION } from '../lib/watch'
import { classify } from '../lib/intake'
import { open as openCookie, seal as sealCookie } from '../lib/auth/seal'
import { split, keyProblem, MAX_KEY_LENGTH, type SubmittedAction } from '../lib/idempotency'
import { verdictFor, shouldResume, resumeDelayMs } from '../lib/queue'
import { actionProblem } from '../lib/actionShape'
import { valueAt, overlapProblem, correctionImpact, stamp, type Version } from '../lib/versioning'
import { availabilityForAssignment } from '../lib/availability'
import {
  backdated,
  dailyCap,
  dailyCapWarning,
  refusesTimeEntry,
  timeEntryAllowed,
  timeEntryNote,
  windowOpening,
  BACKDATING_ALLOWANCE_DAYS,
  type WindowIssue,
  type WindowPerson,
} from '../lib/timeWindow'

/**
 * The last recorded persistence run, or null.
 *
 * Read rather than asserted. This file cannot reach a database, so the honest thing it can do
 * about storage is quote a run that could, and carry its date so nobody mistakes an old pass
 * for a current one.
 */
interface ProofRun {
  at: string
  target: string
  passed: number
  failed: number
  checks: { what: string; ok: boolean; detail: string }[]
}
function readProof(): ProofRun | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'persistence.json'), 'utf8')) as ProofRun
  } catch {
    return null
  }
}
import { describeSave } from '../lib/autosave'
import { classifySecret } from '../lib/secretRules'
import { buildTree } from '../lib/tree'
import { computeHealth, isTerminal } from '../lib/schedule'
import { planSlaDates } from '../lib/sla'
import { buildDailyIms } from '../lib/reports/dailyIms'
import { effortVariance, hoursOn, summariseTime, type TimeEntry } from '../lib/time'
import { summarise } from '../lib/estimation'
import { PERMISSION_KEYS, defaultAccessPolicy } from '../lib/access'
import { publicOrigin } from '../lib/auth/origin'
import { rateAt, rateProblem, costOf, describeCost, type PersonRate } from '../lib/rates'
import {
  contractedPosition,
  decideChangeProblem,
  describeContracted,
  checkChange,
  type ChangeRequest,
  type ChangeStatus,
} from '../lib/changeRequest'
import { profileAt, profilesAt, describeCapacity } from '../lib/capacity'
import {
  weekStarting, weekLabel, weekTotal, isFrozen, submitProblem, decideProblem, statusAfter,
  type Timesheet, type Attester,
} from '../lib/timesheet'
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
  'The message is classified, becomes a work item under the right engagement, and says how it got there.',
  () => {
    /* A mailbox and two rules — the configuration that existed and did nothing. */
    const moduleId = Object.values(BASE.nodes).find((n) => n.kind === 'module')!.id
    let cfg = ok(BASE, {
      t: 'config',
      op: { k: 'upsertIntake', id: null, patch: { address: 'oapil-support@axiocloud.example', scopeId: moduleId, enabled: true } },
      now: NOW,
    } as Action)
    cfg = ok(cfg, {
      t: 'config',
      op: {
        k: 'upsertRoutingRule', id: null,
        patch: { name: 'Inventory to Priya', when: { module: 'inventory', severity: '', keyword: '' }, then: { responsibilityTypeId: 'ISSUE_OWNER', value: 'Priya' }, enabled: true, order: 1 },
      },
      now: NOW,
    } as Action)

    const message = {
      to: 'oapil-support@axiocloud.example',
      from: 'j.okafor@oapil.example',
      subject: 'Inventory postings failing since the upgrade',
      body: 'This is blocking our month end — we cannot post any goods receipts. Production is down.',
      messageId: '<CAF=123@mail.oapil.example>',
      receivedAt: '2026-08-15T08:41:00.000Z',
    }

    const classified = classify(message, cfg.model)
    if ('refused' in classified) {
      return {
        verdict: 'FAIL', actual: `Refused: ${classified.refused.reason}`,
        stops: 'at classification', severity: 'P1', impact: 'Nothing arrives.',
      }
    }
    const draft = classified.draft

    /* The draft becomes a record through the ordinary reducer, so everything downstream applies. */
    const filed = ok(cfg, {
      t: 'create', parentId: draft.parentId, kind: 'issue',
      draft: {
        name: draft.subject, description: draft.description, type: draft.type,
        severity: draft.severity, raisedBy: draft.raisedBy, status: 'Open',
      },
      now: NOW,
    } as Action)
    const made = Object.values(filed.issues).find((i) => i.subject === message.subject)!

    /* An unknown address is refused rather than filed somewhere plausible. */
    const stranger = classify({ ...message, to: 'someone-else@axiocloud.example' }, cfg.model)

    const good =
      draft.parentId === moduleId &&
      draft.severity === 'High' &&
      draft.confidence.severity === 'guessed' &&
      draft.matchedOn.includes('Inventory to Priya') &&
      made.status === 'Open' &&
      'refused' in stranger

    return {
      verdict: good ? 'PARTIAL' : 'FAIL',
      actual: `Classified and filed under the mailbox's scope as ${made.id}, at ${draft.severity} severity — and the severity is reported as ${draft.confidence.severity} rather than stated, because it came from the words "blocking" and "production" rather than from a rule. Rules that fired: ${draft.matchedOn.join(', ')}. The record is created through the same reducer as a person's, so the transition graph, permissions and audit apply. It arrives as "${made.status}": a machine may file work, it may not decide it is being worked on. An unknown address is refused: "${'refused' in stranger ? stranger.refused.reason.slice(0, 90) : ''}"`,
      stops: 'at a real client message — the first mile now exists. A Logic App polls the configured mailbox every three minutes and the endpoint has been proven by a posted message that became an issue, so the two halves meet at the POST; no email a client actually sent has yet travelled the whole path. This becomes PASS when one has.',
      severity: 'P1',
      impact: 'The gap changed shape today rather than closing. It was "no connector exists"; it is now "the connector is deployed and polling and nobody has watched a real message arrive" — a verification, not a build.',
    }
  },
)

scenario(
  'A2',
  'The same message is delivered twice',
  'The second delivery is recognised and does not create a second record.',
  () => {
    const route = fs.readFileSync(path.join(ROOT, 'app/api/intake/route.ts'), 'utf8')
    const dedupes = /messageId/.test(route) && /duplicate/.test(route)
    const guarded = /AXIOMATE_INTAKE_TOKEN/.test(route) && /401|Not authorised/.test(route)
    return {
      verdict: dedupes && guarded ? 'PARTIAL' : 'FAIL',
      actual: `The endpoint refuses a repeat on the sender's own message id and answers "already received" rather than an error — the caller did nothing wrong, and retrying is what it should do. It also refuses everything unless a shared secret is configured: an endpoint that creates records from the internet does not run open. Both are read from the route here rather than driven, because exercising them needs a live database.`,
      stops: 'at a live database — the logic is in the endpoint and cannot be driven by this harness',
      severity: 'P2',
      impact: 'Duplicate delivery, which is the normal failure of every mail integration, does not produce duplicate work.',
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
    const issue = BASE.issues['OAPIL-1']

    /*
     * Four answers, and the third is the one worth arguing about. A capacity model laid over a
     * half-filled directory produces two very different kinds of "no problem", and reporting a
     * name nobody has described as available would invent the fact the check exists to find.
     */
    const stranger = availabilityForAssignment(BASE, issue, 'Someone Who Does Not Exist', NOW)
    const named = availabilityForAssignment(BASE, issue, issue.owner, NOW)
    const nobody = availabilityForAssignment(BASE, issue, 'Unassigned', NOW)

    /* The reducer consults it, rather than the check merely existing beside it. */
    const assigned = act(BASE, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { owner: 'Someone Who Does Not Exist' }, now: NOW,
    } as Action)

    /*
     * And a refusal has a way through. A veto nobody can override does not prevent the
     * assignment — it prevents somebody recording a decision they have already taken.
     */
    const forced = act(BASE, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { owner: 'Someone Who Does Not Exist' },
      now: NOW, acceptUnavailable: true,
    } as Action)

    const kinds = [stranger.kind, named.kind, nobody.kind]
    const good =
      stranger.kind === 'unknown' &&
      nobody.kind === 'clear' &&
      !assigned.error &&
      !forced.error &&
      Boolean(stranger.message)

    return {
      verdict: good ? 'PARTIAL' : 'FAIL',
      actual: `Assignment now consults capacity through the same arithmetic \`upsertAllocation\` uses. A name that is in no directory comes back "${stranger.kind}" rather than free — "${stranger.message.slice(0, 90)}" — which is the distinction that matters, because \`capacityFor\` would otherwise report seven and a half hours a day of somebody nobody has ever described. The seeded owner reads "${named.kind}", an unowned issue "${nobody.kind}". Only absence refuses: being away for the whole window is a fact and is blocked, while being fully committed is a judgement and is recorded against the change instead. A refusal names the escape and \`acceptUnavailable\` takes it, so the decision is written down rather than worked around.`,
      stops: 'at the directory, which is still a free-text column rather than a reference',
      severity: 'P2',
      impact:
        'Work can no longer be handed to somebody who is away without that being a recorded decision. It can still be handed to a typo, because the owner column holds text and nothing constrains it to a person.',
    }
  },
)


scenario(
  'L',
  'A consultant is already overallocated',
  'Committing more of their time surfaces the conflict before it is agreed, and the numbers behind it.',
  () => {
    const engagementId = Object.values(BASE.nodes).find((n) => n.kind === 'engagement')!.id
    const twoProjects = (() => {
      let cur = BASE
      for (const name of ['Remediation', 'Rollout']) {
        cur = ok(cur, { t: 'create', parentId: engagementId, kind: 'project', draft: { name }, now: NOW } as Action)
      }
      return cur
    })()
    const projects = Object.values(twoProjects.nodes).filter((n) => n.kind === 'project')
    const [first, second] = projects

    /* A four-day week, so the model is not quietly assuming everybody is full-time. */
    const person = Object.values(twoProjects.model.people).find((p) => p.name === 'Priya')!
    const profiled = ok(twoProjects, {
      t: 'config',
      op: { k: 'setResourceProfile', personId: person.id, patch: { hoursPerDay: 8, daysPerWeek: 4 } },
      now: NOW,
    } as Action)

    /* 60% on one project for a fortnight. */
    const committed = ok(profiled, {
      t: 'upsertAllocation', id: null, person: 'Priya', projectId: first.id,
      startDate: '2026-09-01', endDate: '2026-09-11', percentage: 60, note: '', now: NOW,
    } as Action)

    /* 60% more on another, over the same fortnight, is more than exists. */
    const clash = act(committed, {
      t: 'upsertAllocation', id: null, person: 'Priya', projectId: second.id,
      startDate: '2026-09-01', endDate: '2026-09-11', percentage: 60, note: '', now: NOW,
    } as Action)

    /* It can still be done — deliberately, and recorded as a decision. */
    const forced = ok(committed, {
      t: 'upsertAllocation', id: null, person: 'Priya', projectId: second.id,
      startDate: '2026-09-01', endDate: '2026-09-11', percentage: 60, note: 'Short-term, agreed with Priya.',
      acceptOverallocation: true, now: NOW,
    } as Action)
    const entry = forced.audit.find((e) => e.field === 'allocation' && e.reason)

    /* Leave comes off before anything is sold, so booking it changes the same arithmetic. */
    const onLeave = ok(committed, {
      t: 'upsertCommitment', id: null, person: 'Priya', kind: 'Leave',
      startDate: '2026-09-07', endDate: '2026-09-11', hoursPerDay: 8, note: '', now: NOW,
    } as Action)
    const before = capacityFor('Priya', onLeave.model.resourceProfiles[person.id], [], Object.values(onLeave.allocations), '2026-09-01', '2026-09-11')
    const after = capacityFor('Priya', onLeave.model.resourceProfiles[person.id], Object.values(onLeave.commitments), Object.values(onLeave.allocations), '2026-09-01', '2026-09-11')

    const good =
      Boolean(clash.error) && Boolean(entry?.reason) &&
      after.availableHours < before.availableHours && after.overallocated && !before.overallocated

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `Refused with the arithmetic rather than a shrug: "${clash.error}" Committing it anyway is allowed and recorded as a decision — the trail says "${entry?.reason?.slice(0, 80)}…". Booking a week of leave moves the same figures: available falls from ${before.availableHours}h to ${after.availableHours}h and the existing commitment becomes an overallocation. A four-day week is honoured, so nobody is assumed full-time.`,
      stops: '—',
      severity: '—',
      impact: 'A plan can now be checked against the people who have to deliver it, and deliberate overallocation is distinguishable from an accident.',
    }
  },
)

scenario(
  'M',
  'New work arrives and there is not enough capacity for it',
  'The delivery plan is shown to be impossible before it is agreed.',
  () => {
    const engagementId = Object.values(BASE.nodes).find((n) => n.kind === 'engagement')!.id
    const moduleId = Object.values(BASE.nodes).find((n) => n.kind === 'module')!.id
    const withProject = ok(BASE, {
      t: 'create', parentId: engagementId, kind: 'project', draft: { name: 'Remediation' }, now: NOW,
    } as Action)
    const project = Object.values(withProject.nodes).find((n) => n.kind === 'project')!
    let live = ok(withProject, { t: 'move', id: moduleId, newParentId: project.id, now: NOW } as Action)

    /* Three pieces of work, estimated at 30 hours each, and one unestimated. */
    for (const id of ['OAPIL-1', 'OAPIL-2', 'OAPIL-3']) {
      live = ok(live, {
        t: 'setEstimate', issueId: id, patch: { approvedEffortHours: 30 }, now: NOW,
      } as Action)
    }
    live = ok(live, {
      t: 'create', parentId: moduleId, kind: 'issue', draft: { name: 'Not estimated yet' }, now: NOW,
    } as Action)

    /* One person, half their time, for a fortnight. */
    const person = Object.values(live.model.people).find((p) => p.name === 'Priya')!
    live = ok(live, {
      t: 'config', op: { k: 'setResourceProfile', personId: person.id, patch: { hoursPerDay: 8, daysPerWeek: 5 } }, now: NOW,
    } as Action)
    live = ok(live, {
      t: 'upsertAllocation', id: null, person: 'Priya', projectId: project.id,
      startDate: '2026-09-01', endDate: '2026-09-11', percentage: 50, note: '', now: NOW,
    } as Action)

    const issues = Object.values(live.issues).filter((i) => !i.deletedAt)
    const planned = issues.reduce((n, i) => {
      const e = live.estimates[i.id]
      return n + (e ? summarise(e, live.model.sizeBands).effortHours ?? 0 : 0)
    }, 0)
    const unestimated = issues.filter((i) => !live.estimates[i.id]).length

    const byName: Record<string, string> = {}
    for (const p of Object.values(live.model.people)) byName[p.name.toLowerCase()] = p.id

    const check = planCheck(
      planned,
      unestimated,
      Object.values(live.allocations),
      live.model.resourceProfiles,
      byName,
      project.id,
      '2026-09-01',
      '2026-09-11',
    )

    const good = check.plannedHours === 90 && check.allocatedHours === 36 && !check.possible && check.unestimatedCount === 1
    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `The plan needs ${check.plannedHours}h and ${check.allocatedHours}h have been committed to it — a shortfall of ${check.shortfallHours}h, visible in week one rather than week six. ${check.unestimatedCount} record has no estimate and is invisible to the figure, which is stated rather than treated as zero. The scheduled pass watches this condition too, so a plan that stops fitting is raised once rather than found in week six.`,
      stops: '—',
      severity: '—',
      impact: 'A delivery manager can see the gap, and the pass raises it once when it appears rather than leaving it to be found.',
    }
  },
)

/* ================================================================== *
 * 3 — SLA and schedule
 * ================================================================== */

scenario(
  'H',
  'An issue approaches its SLA target',
  'It is flagged at risk before it breaches, and the person who can act is told.',
  () => {
    /* An owner the directory knows, so a notification has somewhere to land. */
    const person = Object.values(BASE.model.people).find((p) => p.name === 'Priya')!
    const staffed = ok(BASE, {
      t: 'config', op: { k: 'upsertPerson', id: person.id, name: 'Priya', roleIds: ['ROLE_FUNCTIONAL'] }, now: NOW,
    } as Action)
    const dated = ok(staffed, { t: 'setDates', id: 'OAPIL-1', start: '2026-08-10', end: '2026-08-16', now: NOW } as Action)

    const row = rowFor(dated, 'OAPIL-1', TODAY)
    const health = computeHealth(row, TODAY)

    /* The pass with no memory, as a scheduler would run it the first time. */
    const first = runWatch(dated, EMPTY_OBSERVATION, TODAY, NOW, SCHEDULE_ACTOR)
    const atRisk = first.diff.onset.find((f) => f.subjectId === 'OAPIL-1' && f.condition === 'atRisk')

    const good = health === 'At Risk' && Boolean(atRisk)
    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `Health computes as "${health}" from dates and progress, and the scheduled pass turns it into an event: "${atRisk?.detail}". Going at-risk is not something anybody does — it is time passing against a date nobody moved — so it needed a clock rather than a channel, and a rule subscribes to it like any other event.`,
      stops: '—',
      severity: '—',
      impact: 'Work at risk reaches the person who can act, instead of waiting to be noticed by whoever happens to open the app.',
    }
  },
)

scenario(
  'I',
  'An issue breaches its SLA',
  'It is overdue, somebody is told, and it appears on the report.',
  () => {
    const person = Object.values(BASE.model.people).find((p) => p.name === 'Sam')!
    const staffed = ok(BASE, {
      t: 'config', op: { k: 'upsertPerson', id: person.id, name: 'Sam', roleIds: ['ROLE_FUNCTIONAL'] }, now: NOW,
    } as Action)
    const dated = ok(staffed, { t: 'setDates', id: 'OAPIL-2', start: '2026-08-01', end: '2026-08-10', now: NOW } as Action)

    const row = rowFor(dated, 'OAPIL-2')
    const health = computeHealth(row, TODAY)
    const ims = buildDailyIms(dated, rowsOf(dated), TODAY, 'OAPIL')
    const overdueSection = ims.sections.find((x) => /overdue/i.test(x.title))

    const run = runWatch(dated, EMPTY_OBSERVATION, TODAY, NOW, SCHEDULE_ACTOR)
    const toOwner = Object.values(run.state.notifications).find(
      (n) => n.to === 'Sam' && n.aboutId === 'OAPIL-2',
    )

    const good = health === 'Overdue' && Boolean(overdueSection) && Boolean(toOwner)
    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `Health is "${health}", the daily IMS lists it, and the pass tells the owner: "${toOwner?.body}". The message is attributed to the scheduled pass rather than to a person, because a clock decided it.`,
      stops: '—',
      severity: '—',
      impact: 'A breach is routed to somebody rather than only reported to whoever opens the report.',
    }
  },
)

scenario(
  'SC1',
  'The pass runs every morning for a fortnight and nothing changes',
  'The same condition is reported once, not fourteen times.',
  () => {
    const person = Object.values(BASE.model.people).find((p) => p.name === 'Sam')!
    const staffed = ok(BASE, {
      t: 'config', op: { k: 'upsertPerson', id: person.id, name: 'Sam', roleIds: ['ROLE_FUNCTIONAL'] }, now: NOW,
    } as Action)
    const dated = ok(staffed, { t: 'setDates', id: 'OAPIL-2', start: '2026-08-01', end: '2026-08-10', now: NOW } as Action)

    /* Monday. */
    const monday = runWatch(dated, EMPTY_OBSERVATION, TODAY, NOW, SCHEDULE_ACTOR)
    const firstCount = Object.values(monday.state.notifications).length

    /* Every morning after, each run given the memory the last one stored. */
    let state = monday.state
    let observation = monday.observation
    let laterOnsets = 0
    for (let day = 1; day <= 13; day++) {
      const run = runWatch(state, observation, TODAY, NOW, SCHEDULE_ACTOR)
      state = run.state
      observation = run.observation
      laterOnsets += run.diff.onset.length
    }
    const afterFortnight = Object.values(state.notifications).length

    /* A date moved out, then missed again, is news a second time. */
    const rescheduled = ok(state, { t: 'setDates', id: 'OAPIL-2', start: '2026-08-01', end: '2026-08-25', now: NOW } as Action)
    const cleared = runWatch(rescheduled, observation, TODAY, NOW, SCHEDULE_ACTOR)
    const slipped = runWatch(cleared.state, cleared.observation, '2026-08-26', NOW, SCHEDULE_ACTOR)
    const reRaised = slipped.diff.onset.some((f) => f.subjectId === 'OAPIL-2' && f.condition === 'overdue')

    /**
     * The assertion that distinguishes "suppressed correctly" from "no longer detected".
     *
     * Without it the loop would pass just as well if the condition had stopped being found at
     * all — which is the failure that would make the quiet reassuring and wrong.
     */
    const stillObserved = (observation.subjects['OAPIL-2'] ?? []).includes('overdue')

    const good =
      firstCount > 0 && afterFortnight === firstCount && laterOnsets === 0 && reRaised && stillObserved
    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `${firstCount} message on the first run and ${afterFortnight - firstCount} across the next thirteen: the condition is counted, not repeated — and the memory still records it as true, so the quiet is suppression rather than the condition having stopped being detected. Moving the date cleared it, and missing the new one raised it again — a date somebody moved and then missed is a different fact from the first miss.`,
      stops: '—',
      severity: '—',
      impact: 'This is the failure that makes scheduled alerting useless in its second month. The pass is built around avoiding it rather than patched to.',
    }
  },
)

scenario(
  'SC3',
  'The pass is switched on, and later a condition is added to what it watches',
  'The first run says what is wrong now; a condition ticked later arrives quietly.',
  () => {
    const person = Object.values(BASE.model.people).find((p) => p.name === 'Sam')!
    const staffed = ok(BASE, {
      t: 'config', op: { k: 'upsertPerson', id: person.id, name: 'Sam', roleIds: ['ROLE_FUNCTIONAL'] }, now: NOW,
    } as Action)

    /* Watch one thing to begin with, and give it something to find. */
    const narrowed = ok(staffed, {
      t: 'config', op: { k: 'setWatch', patch: { conditions: ['overdue'] } }, now: NOW,
    } as Action)
    const dated = ok(narrowed, { t: 'setDates', id: 'OAPIL-2', start: '2026-08-01', end: '2026-08-10', now: NOW } as Action)

    /* The first run ever. It raises what it finds rather than swallowing it. */
    const first = runWatch(dated, EMPTY_OBSERVATION, TODAY, NOW, SCHEDULE_ACTOR)
    const raisedOnFirstRun = first.diff.onset.length > 0 && first.diff.seeded === 0

    /*
     * Now switch staleness on, at a threshold this fixture actually crosses — the seeded issues
     * have had no activity since 3 August, which is nine working days rather than the fourteen
     * the shipped default asks for. Tuning the threshold alongside is what a firm does anyway,
     * and it gives the new condition something to find. Finding it is exactly what must not
     * become a message.
     */
    const widened = ok(first.state, {
      t: 'config',
      op: { k: 'setWatch', patch: { conditions: ['overdue', 'stale'], staleAfterDays: 5 } },
      now: NOW,
    } as Action)
    const second = runWatch(widened, first.observation, TODAY, NOW, SCHEDULE_ACTOR)
    const staleFound = Object.values(second.observation.subjects).some((c) => c.includes('stale'))
    const staleRaised = second.diff.onset.some((f) => f.condition === 'stale')

    /* And on the run after that, it is ordinary: known, counted, still not repeated. */
    const third = runWatch(second.state, second.observation, TODAY, NOW, SCHEDULE_ACTOR)

    const good =
      raisedOnFirstRun &&
      staleFound &&
      !staleRaised &&
      second.diff.seeded > 0 &&
      third.diff.onset.length === 0

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `The first run raised ${first.diff.onset.length} and seeded nothing — a firm switching the pass on is told what is wrong now, and a condition true at that moment would otherwise never be announced at all. Ticking staleness on later found ${second.diff.seeded} instances and raised none of them, because that one fires at seven the next morning into a stream people already trust. The run after that raised ${third.diff.onset.length}.`,
      stops: '—',
      severity: '—',
      impact: 'The two cases with no history are treated differently on purpose, and the difference is now pinned rather than described.',
    }
  },
)

scenario(
  'SC2',
  'The pass acts as a machine',
  'What it does is attributed to the clock, and limited to what a machine may do.',
  () => {
    const person = Object.values(BASE.model.people).find((p) => p.name === 'Sam')!
    const staffed = ok(BASE, {
      t: 'config', op: { k: 'upsertPerson', id: person.id, name: 'Sam', roleIds: ['ROLE_FUNCTIONAL'] }, now: NOW,
    } as Action)
    const dated = ok(staffed, { t: 'setDates', id: 'OAPIL-2', start: '2026-08-01', end: '2026-08-10', now: NOW } as Action)
    const run = runWatch(dated, EMPTY_OBSERVATION, TODAY, NOW, SCHEDULE_ACTOR)

    const entry = run.state.audit.find((e) => e.field === 'notification')
    const roles = rolesFor(dated.model, SCHEDULE_ACTOR)

    /* What it may not do, driven rather than read off the grant list. */
    const tryClose = apply(dated, {
      t: 'updateIssue', id: 'OAPIL-2', patch: { status: 'Closed - no defect' }, now: NOW, reason: 'The machine says so.',
    } as Action, SCHEDULE_ACTOR)
    const tryConfigure = apply(dated, {
      t: 'config', op: { k: 'setSla', patch: { High: 1 } }, now: NOW,
    } as Action, SCHEDULE_ACTOR)

    const good =
      entry?.by === SCHEDULE_ACTOR.name &&
      roles.join() === 'ROLE_AUTOMATION' &&
      Boolean(tryClose.error) &&
      Boolean(tryConfigure.error)

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `The trail says "${entry?.by}" rather than a person's name, because nobody decided it. The pass holds ${roles.join(', ')} — not the fallback role an unrecognised human would get — so it may file work and say things about it, and may not close anything ("${tryClose.error}") or change the operating model ("${tryConfigure.error}").`,
      stops: '—',
      severity: '—',
      impact: 'An automated path cannot quietly acquire administrator rights by being nobody in particular.',
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
  'The system can tell that it is outside — and if it cannot judge that, it can at least show what the request costs against what was agreed.',
  () => {
    const engagementId = Object.values(BASE.nodes).find((n) => n.kind === 'engagement')!.id
    const moduleId = Object.values(BASE.nodes).find((n) => n.kind === 'module')!.id

    // The imported log has no project tier — a client's spreadsheet knows engagements and
    // process areas and nothing between them — so one is created and the process area moved
    // under it. Attribution is by project, which is where the domain model puts a SOW.
    const withProject = ok(BASE, {
      t: 'create', parentId: engagementId, kind: 'project',
      draft: { name: 'Inventory remediation' }, now: NOW,
    } as Action)
    const projectId = Object.values(withProject.nodes).find(
      (n) => n.kind === 'project' && n.name === 'Inventory remediation',
    )!.id
    const structured = ok(withProject, { t: 'move', id: moduleId, newParentId: projectId, now: NOW } as Action)

    /* A signed statement of work, and the project delivered under it. */
    const withSow = ok(structured, {
      t: 'upsertSow', id: null, engagementId,
      patch: { reference: 'SOW-2026-014', title: 'Phase 2 — inventory remediation', effortHours: 40, value: 32_000, status: 'Signed' },
      now: NOW,
    } as Action)
    const sow = Object.values(withSow.sows)[0]
    const attributed = ok(withSow, { t: 'attributeToSow', nodeId: projectId, sowId: sow.id, now: NOW } as Action)

    /* Estimate the work, and spend against it. */
    let live = attributed
    for (const id of ['OAPIL-1', 'OAPIL-2', 'OAPIL-3']) {
      live = ok(live, {
        t: 'setEstimate', issueId: id,
        patch: { approvedEffortHours: 18, scores: { business: 3, technical: 3, integration: 3, testing: 3, data: 3 } },
        now: NOW,
      } as Action)
      live = ok(live, {
        t: 'addTime', issueId: id, person: A.name, date: '2026-08-12',
        hours: 6, activity: 'Resolution', billable: true, note: '', now: NOW,
      } as Action)
    }

    const issueIds = Object.values(live.issues).filter((i) => !i.deletedAt).map((i) => i.id)
    const position = sowPosition(live.sows[sow.id], issueIds, live.estimates, live.timeEntries, live.model.sizeBands)

    /* Detaching is visible too: a project attributed to nothing is invisible to every figure. */
    const detached = ok(live, { t: 'attributeToSow', nodeId: projectId, sowId: null, now: NOW } as Action)
    const orphanCount = Object.values(detached.nodes).filter((n) => n.kind === 'project' && !n.sowId && !n.deletedAt).length

    /* A draft SOW cannot have work delivered under it. */
    const draft = ok(live, {
      t: 'upsertSow', id: null, engagementId,
      patch: { reference: 'SOW-2026-015', title: 'Phase 3', effortHours: 10, value: 8_000, status: 'Draft' },
      now: NOW,
    } as Action)
    const draftSow = Object.values(draft.sows).find((x) => x.reference === 'SOW-2026-015')!
    const tooEarly = act(draft, { t: 'attributeToSow', nodeId: projectId, sowId: draftSow.id, now: NOW } as Action)

    /* And a reference the database would refuse is refused here, in words, first. */
    const duplicate = act(live, {
      t: 'upsertSow', id: null, engagementId,
      patch: { reference: 'SOW-2026-014', title: 'Typed twice', effortHours: 5, value: 0, status: 'Draft' },
      now: NOW,
    } as Action)

    const good =
      position.baselineHours === 40 &&
      position.plannedHours === 54 &&
      position.forecastOverrun &&
      position.actualHours === 18 &&
      orphanCount === 1 &&
      Boolean(tooEarly.error) &&
      Boolean(duplicate.error)

    return {
      verdict: good ? 'PARTIAL' : 'FAIL',
      actual: `${describePosition(position)} The overrun is arithmetic rather than opinion: agreed effort is on the SOW, planned comes from the estimates, spent comes from the recorded hours. A project attributed to nothing is counted as such (${orphanCount} here), a draft SOW refuses work ("${tooEarly.error}"), and a reference the database would reject is refused here first: "${duplicate.error}"`,
      stops: 'at the judgement — nothing reads the scope statement and decides whether a particular request is inside it',
      severity: 'P2',
      impact: 'Scope leakage is now measurable where it shows up as effort. Whether a request is in scope remains a commercial call, and the product makes its consequence visible rather than pretending to make the call.',
    }
  },
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
      actual: `A CR can be raised as a work item of type "${made.type}"${existing ? '' : ' — the type is configuration and had to be added first'}, linked to the issue that prompted it, and it cannot start until somebody with the authority approves it (scenario P). What it still carries is no value of its own: approving it does not move the agreed effort or value on the statement of work, so a firm sees the overrun rather than the amendment.`,
      stops: 'at the join — a change request is now a priced record with an approval and an effective date (CR1), and this issue-shaped one is not linked to it. `ChangeRequest.issueId` exists and nothing sets it, so the register and the contract still describe the same change twice.',
      severity: 'P2',
      impact:
        'The valuation gap this described is closed: an approved change moves the contracted position without touching the baseline. What is left is that the issue somebody raises and the variation somebody prices are two records, and only a person knows they are the same change.',
    }
  },
)

scenario(
  'P',
  'A change request is approved',
  'The approval is given by somebody with the authority for it, and the work cannot start without it.',
  () => {
    /* A CR, raised. The work type is configuration, so it is added first. */
    const typed = ok(BASE, {
      t: 'config',
      op: { k: 'upsertWorkType', id: null, label: 'Change Request', description: 'Chargeable change to agreed scope' },
      now: NOW,
    } as Action)
    const withCr = ok(typed, {
      t: 'create', parentId: typed.issues['OAPIL-1'].parentId!, kind: 'issue',
      draft: { name: 'Add a second approval step', type: 'Change Request', severity: 'Medium' }, now: NOW,
    } as Action)
    const crId = Object.values(withCr.issues).find((i) => i.subject === 'Add a second approval step')!.id

    /* Roles, so the two sides of the decision are different people with different authority. */
    const named = (name: string, roleId: string, base = withCr) => {
      const person = Object.values(base.model.people).find((p) => p.name === name)
      return ok(base, {
        t: 'config', op: { k: 'upsertPerson', id: person?.id ?? null, name, roleIds: [roleId] }, now: NOW,
      } as Action)
    }
    let staffed = named('Priya', 'ROLE_FUNCTIONAL')
    staffed = named('Dana', 'ROLE_CLIENT_SPONSOR', staffed)
    const consultant: Actor = { id: 'priya', name: 'Priya' }
    const sponsor: Actor = { id: 'dana', name: 'Dana' }

    /* 1. Work cannot start on it. */
    const unapproved = apply(staffed, {
      t: 'updateIssue', id: crId, patch: { status: 'In Progress' }, now: NOW,
    } as Action, consultant)

    /* 2. Ask. */
    const asked = (() => {
      const r = apply(staffed, {
        t: 'requestApproval', subjectId: crId, ruleId: 'APPR_CR_START',
        note: 'Two extra days of configuration and a retest.', now: NOW,
      } as Action, consultant)
      if (r.error) throw new Error(`request refused: ${r.error}`)
      return r.state
    })()
    const approvalId = Object.values(asked.approvals)[0].id

    /* 3. The asker cannot answer their own question. */
    const selfApproved = apply(asked, {
      t: 'decideApproval', id: approvalId, decision: 'approved', note: 'Fine by me.', now: NOW,
    } as Action, consultant)

    /* 4. Nor can somebody without the role the rule names. */
    const analyst = named('Sam', 'ROLE_SUPPORT', asked)
    const wrongRole = apply(analyst, {
      t: 'decideApproval', id: approvalId, decision: 'approved', note: '', now: NOW,
    } as Action, { id: 'sam', name: 'Sam' })

    /* 5. The sponsor can, and then the work may start. */
    const decided = (() => {
      const r = apply(asked, {
        t: 'decideApproval', id: approvalId, decision: 'approved',
        note: 'Agreed at the Thursday governance call.', now: NOW,
      } as Action, sponsor)
      if (r.error) throw new Error(`decision refused: ${r.error}`)
      return r.state
    })()
    const started = apply(decided, {
      t: 'updateIssue', id: crId, patch: { status: 'In Progress' }, now: NOW,
    } as Action, consultant)

    /* 6. A rejection blocks exactly as a missing decision does, and stays on the record. */
    const rejected = apply(asked, {
      t: 'decideApproval', id: approvalId, decision: 'rejected',
      note: 'Not within this phase — raise it for the next release.', now: NOW,
    } as Action, sponsor)
    const blockedAfterRejection = apply(rejected.state, {
      t: 'updateIssue', id: crId, patch: { status: 'In Progress' }, now: NOW,
    } as Action, consultant)

    const good =
      Boolean(unapproved.error) && Boolean(selfApproved.error) && Boolean(wrongRole.error) &&
      !started.error && Boolean(blockedAfterRejection.error) &&
      decided.approvals[approvalId].decidedBy === 'Dana'

    return {
      verdict: good ? 'PARTIAL' : 'FAIL',
      actual: `Unapproved, the CR cannot start: "${unapproved.error}" The consultant who asked cannot answer — "${selfApproved.error}" — and neither can an analyst, because the rule names the sponsor: "${wrongRole.error}" Once the sponsor approves, the work starts. A rejection blocks the same move and stays on the record: "${blockedAfterRejection.error}"`,
      stops: 'at this issue-shaped change only. Approving a `ChangeRequest` DOES move the contracted position now — baseline plus approved movements, computed on read (CR1) — and the two paths are not yet joined: this scenario approves a work item, not a variation.',
      severity: 'P2',
      impact: 'A change can no longer be delivered without somebody with authority agreeing to it. What it is worth is still not recorded anywhere.',
    }
  },
)

scenario(
  'P2',
  'A firm writes an approval rule that nobody can satisfy',
  'The rule is refused, rather than becoming a wall the work never gets past.',
  () => {
    const orphan = act(BASE, {
      t: 'config',
      op: {
        k: 'setApprovalRules',
        rules: [
          {
            id: 'APPR_TEST', label: 'Impossible', workTypes: [], status: 'In Progress',
            deciderRoleIds: [], question: 'Well?', enabled: true,
          },
        ],
      },
      now: NOW,
    } as Action)
    const silent = act(BASE, {
      t: 'config',
      op: {
        k: 'setApprovalRules',
        rules: [
          {
            id: 'APPR_TEST', label: 'Unasked', workTypes: [], status: 'In Progress',
            deciderRoleIds: ['ROLE_ENGAGEMENT_LEAD'], question: '  ', enabled: true,
          },
        ],
      },
      now: NOW,
    } as Action)
    return {
      verdict: orphan.error && silent.error ? 'PASS' : 'FAIL',
      actual: `A rule with no decider is refused — "${orphan.error}" — and so is one that asks nothing: "${silent.error}" Both would produce work that reaches a status never, and whoever wrote the rule would hear about it weeks later from somebody who could not proceed.`,
      stops: '—',
      severity: '—',
      impact: 'A control that cannot be satisfied is a wall, and the configuration screen refuses to build one.',
    }
  },
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
  'The claim is checked against an identity provider before anything is allowed.',
  () => {
    const hasProvider = !absent(/login.microsoftonline.com/)
    const verifiesToken = !absent(/jwtVerify/)
    const checksNonce = !absent(/expectedNonce/)
    const usesPkce = !absent(/code_challenge_method/)
    const signsCookie = !absent(/createHmac/)
    const refusesUnverified = !absent(/signInRequired: true/)

    /* The cookie is real code and can be driven here, unlike the redirect flow. */
    const key = 'a-secret-of-at-least-thirty-two-characters'
    const claims = {
      oid: '00000000-1111-2222-3333-444444444444',
      name: 'Priya Raman',
      email: 'priya@axiocloud.example',
      exp: Math.floor(Date.parse('2099-01-01T00:00:00Z') / 1000),
    }
    const good = openCookie(sealCookie(claims, key), key)
    const tampered = openCookie(sealCookie(claims, key).replace(/^./, (ch) => (ch === 'a' ? 'b' : 'a')), key)
    const stale = openCookie(
      sealCookie({ ...claims, exp: Math.floor(Date.parse('2020-01-01T00:00:00Z') / 1000) }, key),
      key,
    )
    /* And a cookie signed with somebody else's key is refused, which is the whole point. */
    const forged = openCookie(sealCookie(claims, 'a-different-secret-of-thirty-two-plus-chars'), key)

    const cookieHolds =
      'claims' in good &&
      good.claims.oid === claims.oid &&
      'reason' in tampered &&
      'reason' in forged &&
      forged.reason === 'bad signature' &&
      'reason' in stale &&
      stale.reason === 'expired'

    const built = hasProvider && verifiesToken && checksNonce && usesPkce && signsCookie && refusesUnverified
    return {
      verdict: built && cookieHolds ? 'PARTIAL' : 'FAIL',
      actual: `Entra ID sign-in is built: authorisation-code flow with PKCE, the id token verified against the published keys for issuer, audience and expiry, and the nonce checked against the one this server generated. The session cookie is signed and driven here rather than read — a valid one round-trips, a tampered one and one signed with another key are both refused, and an expired one reports "${'reason' in stale ? stale.reason : ''}" rather than being quietly accepted. With a provider configured the write endpoint refuses an unverified request; with none configured the application runs as the single operator exactly as before, because a deployment without credentials should work rather than show a login it cannot satisfy.`,
      stops:
        'at the harness, not at the tenant. There IS a real registration now and real people sign in against it — and running it found what constructing it could not: the callback redirected to the internal container address, so a completed sign-in ended on a browser error page. Verified-by-construction is precisely what missed that. AU3 now covers the redirect; the provider handshake itself still cannot be driven here, because that needs a test tenant.',
      severity: 'P1',
      impact: 'The four environment values are set and grants rest on a proven identity. What remains is that no check in this suite exercises the round trip through a real provider, which is the one class of auth fault that has actually reached production.',
    }
  },
)

scenario(
  'ST2d',
  'A deployment starts before its secrets have been written',
  'Nothing is signed or accepted with a value that only looks like a secret.',
  () => {
    /*
     * The state every first Azure deployment begins in. App Service resolves a Key Vault
     * reference by substitution, and when it cannot — the identity has no role yet, the secret
     * has not been written — it passes the reference through literally rather than blanking it.
     * The result is a seventy-character string that clears any length check, and one anybody
     * can reconstruct from the vault and secret names in this repository's own templates.
     */
    const unresolved = '@Microsoft.KeyVault(VaultName=axiomate-kv;SecretName=axiomate-session-secret)'
    const longEnough = unresolved.length >= 32

    const referenceRefused = classifySecret('AXIOMATE_SESSION_SECRET', unresolved, 32)
    const placeholderRefused = classifySecret('AXIOMATE_SESSION_SECRET', 'changeme', 4)
    const realAccepted = classifySecret(
      'AXIOMATE_SESSION_SECRET',
      'a-secret-of-at-least-thirty-two-characters',
      32,
    )

    const good =
      longEnough &&
      'problem' in referenceRefused &&
      'problem' in placeholderRefused &&
      'value' in realAccepted

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `The unresolved reference is ${unresolved.length} characters, so a length check alone accepts it — and it is refused instead: "${'problem' in referenceRefused ? referenceRefused.problem.slice(0, 90) : ''}…" A placeholder is refused too, a real key is accepted, and the same guard reads both bearer tokens, where an unresolved reference would otherwise have become the accepted token rather than merely a weak signing key.`,
      stops: '—',
      severity: '—',
      impact: 'The deployment that has not had its secrets written yet now refuses to sign or accept anything, rather than working with a value published in its own templates.',
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
  'The second write is refused as stale rather than silently overwriting the first.',
  () => {
    /*
     * Both browsers read the same record, so both stamp the same expectation. What follows is
     * the server replaying them in the order they arrive, against stored state that moves under
     * the second one.
     */
    const seen = BASE.issues['OAPIL-1']
    const priyaSaw = { owner: seen.owner }
    const samSaw = { owner: seen.owner }

    // A value that is actually different from what both of them read — the seed already owns
    // this issue to Priya, and a write that changes nothing leaves nothing to be stale against.
    const priyaWins = ok(BASE, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { owner: 'Dev' }, expected: priyaSaw, now: NOW,
    } as Action)

    const samLoses = act(priyaWins, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { owner: 'Sam' }, expected: samSaw, now: NOW,
    } as Action)

    /*
     * Editing a different field is not a conflict, and this is the case row-level versioning
     * gets wrong: a due date and an owner are not in dispute just because one record holds
     * both.
     */
    const different = act(priyaWins, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { nextAction: 'Chase the client' },
      expected: { nextAction: seen.nextAction }, now: NOW,
    } as Action)

    /* And the loser can proceed once they have seen what happened. */
    const afterReading = act(priyaWins, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { owner: 'Sam' },
      expected: { owner: priyaWins.issues['OAPIL-1'].owner }, now: NOW,
    } as Action)

    /* An action with no expectation is unchecked, which is what automation relies on. */
    const unstamped = act(priyaWins, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { owner: 'Nobody' }, now: NOW,
    } as Action)

    const good =
      Boolean(samLoses.error) &&
      priyaWins.issues['OAPIL-1'].owner === 'Dev' &&
      samLoses.state.issues['OAPIL-1'].owner === 'Dev' &&
      !different.error &&
      !afterReading.error &&
      !unstamped.error

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `The second write is refused and names both values: "${samLoses.error}" The record still reads ${samLoses.state.issues['OAPIL-1'].owner}, so nothing was overwritten. Changing a different field on the same record is allowed — comparing only the fields being written is what stops a due date conflicting with an owner, which is the false conflict that makes people switch optimistic locking off. Once the loser has read the new value their write goes through.`,
      stops: '—',
      severity: '—',
      impact: 'Two consultants working one record are stopped when they genuinely disagree and left alone when they do not, and neither loses work without being told.',
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
    /*
     * The outage. Four attempts are spent inline with backoff; the fifth failure is where the
     * queue used to end its own session.
     */
    const during = [1, 2, 3, 4].map((attempts) => verdictFor({ kind: 'network', attempts }))
    const exhausted = verdictFor({ kind: 'network', attempts: 5 })

    /* Ten seconds later the network is back, and the browser says so. */
    const onReconnect = shouldResume({
      halt: exhausted.halt, trigger: 'online', pausedForMs: 10_000, pauses: 0,
      online: true, visible: false,
    })

    /* A laptop that slept, reopened on the same tab. */
    const onReturn = shouldResume({
      halt: 'paused', trigger: 'visible', pausedForMs: 600_000, pauses: 2,
      online: true, visible: true,
    })

    /* And a tab nobody touches: the timer waits out the ladder rather than hammering. */
    const tooSoon = shouldResume({
      halt: 'paused', trigger: 'timer', pausedForMs: 15_000, pauses: 0,
      online: true, visible: false,
    })
    const eventually = shouldResume({
      halt: 'paused', trigger: 'timer', pausedForMs: 31_000, pauses: 0,
      online: true, visible: false,
    })

    /* Nothing is attempted while the machine knows it is offline. */
    const whileOffline = shouldResume({
      halt: 'paused', trigger: 'timer', pausedForMs: 600_000, pauses: 3,
      online: false, visible: true,
    })

    /*
     * The failures that must NOT resume, because trying again cannot change the answer. A
     * refusal is a disagreement about a record and every action queued behind it was computed
     * from the version that lost; a deployment with no database has nothing to write to.
     */
    const refused = verdictFor({ kind: 'response', status: 409, serverError: 'Owner has moved on.', attempts: 1 })
    const malformed = verdictFor({ kind: 'response', status: 400, attempts: 1 })
    const oversized = verdictFor({ kind: 'response', status: 413, attempts: 1 })
    /* A gateway or a renamed route, which the endpoint itself never emits. */
    const gateway = verdictFor({ kind: 'response', status: 403, attempts: 1 })
    const gone = verdictFor({ kind: 'response', status: 404, attempts: 1 })
    /* And a database refusal the server has marked deterministic. */
    const constraint = verdictFor({ kind: 'response', status: 500, permanent: true, attempts: 1 })
    /* While a busy server is still worth waiting for, despite living among the permanents. */
    const busy = verdictFor({ kind: 'response', status: 429, attempts: 1 })
    const noDatabase = verdictFor({ kind: 'response', disabled: true, status: 200, attempts: 1 })
    const stoppedStay = [refused, malformed, oversized, noDatabase, gateway, gone, constraint].every(
      (v) => !shouldResume({ halt: v.halt, trigger: 'online', pausedForMs: 1e9, pauses: 0, online: true, visible: true }),
    )

    /* The ladder escalates and is capped, so an hour-long outage is not asked about constantly. */
    const ladder = [0, 1, 2, 3, 9].map((n) => resumeDelayMs(n))
    const escalates = ladder[0] < ladder[1] && ladder[1] < ladder[2] && ladder[3] === ladder[4]

    const good =
      during.every((v) => v.halt === 'running') &&
      exhausted.halt === 'paused' && exhausted.keepQueue &&
      onReconnect && onReturn && eventually &&
      !tooSoon && !whileOffline &&
      refused.halt === 'stopped' && refused.keepQueue &&
      malformed.halt === 'stopped' &&
      oversized.halt === 'stopped' &&
      gateway.halt === 'stopped' && gone.halt === 'stopped' &&
      constraint.halt === 'stopped' &&
      busy.halt === 'running' &&
      noDatabase.halt === 'stopped' && !noDatabase.keepQueue &&
      stoppedStay && escalates

    return {
      verdict: good ? 'PARTIAL' : 'FAIL',
      actual: `An outage is retried ${during.length} times inline and then the queue pauses rather than ending the session — holding its work and saying "${describeSave({ status: exhausted.status, pending: 3, savedAt: null })}". It starts again the moment connectivity returns, when the tab is looked at again, or after ${resumeDelayMs(0) / 1000}s on its own, escalating to ${resumeDelayMs(9) / 1000}s and never while the machine reports itself offline. The failures that cannot improve stay stopped through every trigger: a refused change, a malformed request, an oversized batch, a gateway 403, a renamed route, a database constraint the server marked deterministic, and a deployment with no database — the last clearing its queue because there is nothing to deliver to, the others keeping theirs so the unload beacon can still try. What is proven is the policy: \`verdictFor\` and \`shouldResume\` are pure and driven directly. A queue actually resuming has never run in a browser, because without a database the endpoint answers \`disabled\` and stops before the paused path is reachable at all.`,
      stops: 'at a resume observed in a browser',
      severity: 'P2',
      impact:
        'A ten-second outage no longer ends persistence for the rest of the session. The rule is proven; the recovery it describes has not been watched happen.',
    }
  },
)

scenario(
  'FL2',
  'A malformed or hostile write reaches the API',
  'It is rejected before it touches stored state.',
  () => {
    const N = NOW
    /*
     * Driven against the real validator rather than grepped for. The risk FL2 names is specific:
     * the reducer merges an edit with `{ ...record, ...patch }`, so anything inside `patch`
     * lands in the record, and TypeScript is erased by the time the request arrives.
     */
    const refused = (a: unknown) => actionProblem(a) !== null
    const accepted = (a: unknown) => actionProblem(a) === null

    const legitimate = [
      { t: 'updateIssue', id: 'OAPIL-1', patch: { owner: 'Sam', severity: 'High', percentOverride: 50, plannedEnd: null }, now: N },
      { t: 'updateIssue', id: 'OAPIL-1', patch: { owner: 'Sam' }, now: N, expected: { owner: 'Priya' }, key: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' },
      { t: 'updateIssue', id: 'OAPIL-1', patch: {}, now: N },
      { t: 'addNote', issueId: 'OAPIL-1', body: 'x', noteType: 'General Update', pinned: false, now: N },
    ]

    const hostile: [string, unknown][] = [
      ['a typo inside the patch', { t: 'updateIssue', id: 'OAPIL-1', patch: { ownerr: 'Sam' }, now: N }],
      ['a wrong type on a real field', { t: 'updateIssue', id: 'OAPIL-1', patch: { status: 12345 }, now: N }],
      ['an id smuggled into the patch', { t: 'updateIssue', id: 'OAPIL-1', patch: { id: 'OTHER-9' }, now: N }],
      ['an unknown top-level field', { t: 'updateIssue', id: 'OAPIL-1', patch: { owner: 'Sam' }, now: N, admin: true }],
      ['an action kind that is not a kind', { t: 'toString', now: N }],
      ['notify, which rules raise and clients may not', { t: 'notify', now: N }],
      ['no discriminator at all', { id: 'OAPIL-1', now: N }],
      ['an array where an object belongs', ['updateIssue']],
      ['a missing required field', { t: 'updateIssue', patch: { owner: 'Sam' }, now: N }],
    ]

    const wrongly = legitimate.filter(refused)
    const missed = hostile.filter(([, a]) => accepted(a))
    const sample = actionProblem(hostile[0][1]) ?? ''
    const good = wrongly.length === 0 && missed.length === 0

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `${hostile.length} malformed or hostile actions are refused before the database is considered, and ${legitimate.length} legitimate ones — including an empty patch, a concurrency expectation and an idempotency key — still pass. The refusal names the field rather than the request: "${sample}". The patch is checked field by field, which is the part that matters: the reducer merges an edit with a spread, so an unrecognised key lands in the record and a mistyped one replaces a real field. Whether a status is one this firm uses is left to the reducer, which owns the transition graph and answers with the routes that exist — two lists here would be free to disagree.${good ? '' : ` Wrongly refused: ${wrongly.length}. Missed: ${missed.map(([l]) => l).join(', ')}.`}`,
      stops: good ? '—' : 'at the cases listed above',
      severity: good ? '—' : 'P1',
      impact: good
        ? 'A client bug or a hostile caller can no longer write a field the record does not have, or a type it cannot hold.'
        : 'An action can still put an unrecognised or mistyped field into stored state.',
    }
  },
)


scenario(
  'FL3',
  'The persistence layer is exercised at all',
  'Writes reach Postgres and reload correctly.',
  () => {
    /*
     * This harness has no database and never will — it drives the reducer, which is a pure
     * function. So it cannot test persistence; it can only cite a run that did, with the date
     * attached so a stale one is visible rather than implied.
     */
    const proof = readProof()
    if (!proof) {
      return {
        verdict: 'NOT TESTABLE',
        actual:
          'No persistence run has been recorded. `npm run audit:persistence` writes data/persistence.json against a real database; until it has, the repository, mappers and write path typecheck and nothing more.',
        stops: 'at the absence of a database',
        severity: 'P1',
        impact: 'Every claim about storage is a claim about code that has never executed.',
      }
    }
    const all = proof.failed === 0
    return {
      verdict: all ? 'PASS' : 'FAIL',
      actual: `${proof.passed} of ${proof.passed + proof.failed} persistence checks passed against ${proof.target}, recorded ${proof.at.slice(0, 10)}. The run writes values chosen to break careless mapping and reads the whole workspace back through the ordinary load path: quarter hours as a decimal rather than a float, a zero that must not return as null, money with pennies, a date written as a day, a note keeping its quotes and its newline, an audit reason keeping its punctuation. It also covers the two things only a database can show — that a capped trail keeps the newest entries rather than the oldest, and that the id counter is stored so a restart cannot re-mint an id.${all ? '' : ' Failures: ' + proof.checks.filter((c) => !c.ok).map((c) => c.what).join('; ')}`,
      stops: all ? '—' : 'at the checks listed above',
      severity: all ? '—' : 'P1',
      impact: all
        ? 'Twenty-one tables, fourteen mapper pairs and a write path with an arm per action have now executed against Postgres rather than only typechecked.'
        : 'A mapper is dropping or coercing a value, which is the quiet failure this run exists to catch.',
    }
  },
)


scenario(
  'U',
  'A consultant submits a timesheet',
  'The week is presented for approval, and approval freezes exactly what was approved.',
  () => {
    /*
     * Driven against lib/timesheet.ts directly, before anything calls it. If the rules are wrong
     * this is where it costs nothing to find out — which is the reason the plan puts the
     * scenarios before the reducer arms rather than after them.
     */
    const me: Attester = { name: 'Priya', maySubmit: true, mayApprove: false }
    const week = weekStarting('2026-08-19') // a Wednesday
    const entry = (date: string, hours: number, billable = true): TimeEntry => ({
      id: `time-${date}-${hours}`, issueId: 'OAPIL-1', person: 'Priya', date, hours,
      activity: 'Investigation', billable, note: '', createdBy: 'Priya', createdAt: NOW,
      updatedBy: null, updatedAt: null, deletedAt: null,
    })

    const entries = [
      entry('2026-08-17', 7.5),
      entry('2026-08-19', 6),
      entry('2026-08-21', 2, false),
      entry('2026-08-24', 8),                                  // the NEXT week
      { ...entry('2026-08-18', 4), person: 'Sam' },            // somebody else
      { ...entry('2026-08-20', 3), deletedAt: NOW },           // withdrawn
    ]

    /* The week is Monday-based, and a mid-week date resolves to its Monday. */
    const monday = week === '2026-08-17'
    const total = weekTotal(entries, 'Priya', week)

    /* Nothing is submitted yet, so nothing is frozen. */
    const openBefore = isFrozen([], 'Priya', '2026-08-19')

    const clean = submitProblem([], 'Priya', week, me)

    const submitted: Timesheet = {
      id: 'ts-1', person: 'Priya', weekStarting: week, status: 'Submitted',
      submittedAt: NOW, submittedBy: 'Priya', decidedAt: null, decidedBy: null, reason: null,
    }

    /* Twice is refused, and says which state it is already in. */
    const again = submitProblem([submitted], 'Priya', week, me)
    /* Somebody else's week is refused even though this actor holds the permission. */
    const notMine = submitProblem([], 'Sam', week, me)
    /* And without the permission at all. */
    const notAllowed = submitProblem([], 'Priya', week, { ...me, maySubmit: false })
    /* A week that is not a Monday is refused rather than silently rounded. */
    const notAMonday = submitProblem([], 'Priya', '2026-08-19', me)

    /* An empty week submits. "I was on leave" is a claim somebody is entitled to make. */
    const emptyWeek = submitProblem([], 'Priya', weekStarting('2026-09-07'), me)

    /* Once submitted, the week is frozen — and the refusal names which of the two states. */
    const frozenNow = isFrozen([submitted], 'Priya', '2026-08-19')
    const nextWeekStillOpen = isFrozen([submitted], 'Priya', '2026-08-24')
    const otherPersonOpen = isFrozen([submitted], 'Sam', '2026-08-19')
    const approvedSheet: Timesheet = { ...submitted, status: 'Approved', decidedBy: 'Nishant', decidedAt: NOW }
    const frozenApproved = isFrozen([approvedSheet], 'Priya', '2026-08-19')

    const good =
      monday &&
      total.hours === 15.5 &&
      total.billable === 13.5 &&
      openBefore === null &&
      clean === null &&
      again !== null &&
      /already submitted/.test(again ?? '') &&
      notMine !== null &&
      notAllowed !== null &&
      notAMonday !== null &&
      emptyWeek === null &&
      frozenNow === 'Submitted' &&
      frozenApproved === 'Approved' &&
      nextWeekStillOpen === null &&
      otherPersonOpen === null

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `A week is the Monday containing a date — 19 August resolves to ${week}. The total is computed from live entries rather than copied onto the sheet: ${total.hours}h, of which ${total.billable}h billable, correctly excluding the next week, another person, and a withdrawn entry. Submitting an open week succeeds; submitting it twice is refused with "${(again ?? '').slice(0, 60)}"; submitting somebody else's week is refused even holding the permission, because a timesheet is a personal attestation. A week that is not a Monday is refused rather than rounded. An EMPTY week submits — "I was on leave" is a claim, and refusing it strands the one person with nothing to report. Once submitted the week is frozen and the freeze reports which state it is in (${frozenNow} here, ${frozenApproved} once approved) rather than a boolean, because "awaiting approval" and "already approved" call for different next moves. The next week and another person stay open.`,
      stops: 'nowhere in the rules. submitTimesheet calls these, U2 drives the freeze through the reducer, and the persistence proof shows a submitted week surviving a reload. What no check here opens is the screen — the Submit control is verified by construction, as the row menu is.',
      severity: '—',
      impact: 'Hours can now be signed off, which is what makes them billable. The rules are driven here directly, so a mistake in them is found before any caller is involved.',
    }
  },
)

scenario(
  'V',
  'A submitted timesheet is rejected',
  'The rejection returns specific entries, says why, and the corrected resubmission is traceable.',
  () => {
    const approver: Attester = { name: 'Nishant', maySubmit: true, mayApprove: true }
    const author: Attester = { name: 'Priya', maySubmit: true, mayApprove: true }
    const week = weekStarting('2026-08-19')
    const submitted: Timesheet = {
      id: 'ts-1', person: 'Priya', weekStarting: week, status: 'Submitted',
      submittedAt: NOW, submittedBy: 'Priya', decidedAt: null, decidedBy: null, reason: null,
    }

    /* The rule that has no configuration switch: the asker may never be the decider. */
    const selfApproval = decideProblem(submitted, 'approved', undefined, author)
    /* Even though `author` holds the approve permission — it is not a permission question. */
    const holdsPermission = author.mayApprove

    /* Approving needs no reason. Returning does. */
    const approveClean = decideProblem(submitted, 'approved', undefined, approver)
    const rejectNoReason = decideProblem(submitted, 'rejected', '   ', approver)
    const rejectWithReason = decideProblem(submitted, 'rejected', 'Thursday is booked to the wrong issue.', approver)
    const notAnApprover = decideProblem(submitted, 'approved', undefined, { ...approver, mayApprove: false })

    /* A returned week is editable again — that is what returning it is for. */
    const returned: Timesheet = {
      ...submitted, status: 'Rejected', decidedAt: NOW, decidedBy: 'Nishant',
      reason: 'Thursday is booked to the wrong issue.',
    }
    const editableAgain = isFrozen([returned], 'Priya', '2026-08-19')
    /* And it can be resubmitted, unlike one that is submitted or approved. */
    const resubmit = submitProblem([returned], 'Priya', week, { name: 'Priya', maySubmit: true, mayApprove: false })
    /* Deciding one that was already decided is refused, and says which way. */
    const decideTwice = decideProblem({ ...submitted, status: 'Approved' }, 'rejected', 'no', approver)
    const decideReturned = decideProblem(returned, 'approved', undefined, approver)

    const good =
      selfApproval !== null &&
      holdsPermission &&
      approveClean === null &&
      rejectNoReason !== null &&
      rejectWithReason === null &&
      notAnApprover !== null &&
      editableAgain === null &&
      resubmit === null &&
      decideTwice !== null &&
      decideReturned !== null &&
      statusAfter('approved') === 'Approved' &&
      statusAfter('rejected') === 'Rejected'

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `The person who submitted cannot decide their own week — refused with "${(selfApproval ?? '').slice(0, 70)}" — and that holds even though this actor DOES hold the approve permission, because a self-approval is not a weaker control but the absence of one. Approving needs no reason; returning needs one, refused otherwise with "${(rejectNoReason ?? '').slice(0, 60)}": "yes" is complete on its own, "no" leaves somebody guessing what to change. A returned week is editable again — isFrozen answers ${JSON.stringify(editableAgain)} — and resubmits cleanly, which is the whole correction loop. Deciding a week twice is refused and names which way it already went. The reason travels on the row, so what was returned and why is answerable later without reconstructing it.`,
      stops: 'nowhere in the rules. decideTimesheet calls these, and the persistence proof shows a returned week keeping its reason and becoming editable again after a reload — both halves of the loop, not just the refusal.',
      severity: '—',
      impact: 'The correction loop exists for the record that drives revenue, and the rule that stops a self-approval is driven rather than asserted — through the reducer as well as here.',
    }
  },
)

scenario(
  'U2',
  'A submitted week refuses edits, and every other week does not',
  'Hours inside a submitted week cannot be added, changed or withdrawn — and nothing else is affected.',
  () => {
    /*
     * The step the plan names as carrying the most regression risk, and this is the check that
     * earns it. A guard that only ever refuses is indistinguishable from a broken feature, so
     * both directions are asserted: refused inside the week, still allowed everywhere else.
     */
    const priya: Actor = { id: 'u-priya', name: 'Priya' }
    const lead: Actor = { id: 'u-lead', name: 'Nishant' }
    // Actor-aware, because who is asking is the whole subject here: the shared `ok`/`act`
    // helpers pin one actor, and a self-approval cannot be tested with a single identity.
    const actAs = (st: WorkspaceState, a: Action, who: Actor) => apply(st, a, who)
    const okAs = (st: WorkspaceState, a: Action, who: Actor): WorkspaceState => {
      const r = actAs(st, a, who)
      if (r.error) throw new Error(`${a.t} refused: ${r.error}`)
      return r.state
    }
    /*
     * Entirely in the past. The harness clock is 2026-08-15 and `checkEntry` refuses a day that
     * has not happened — so a fixture set in the future fails on the entry rather than on the
     * freeze, which is the wrong thing to be testing.
     */
    const week = weekStarting('2026-08-05')

    const withHours = okAs(
      BASE,
      { t: 'addTime', issueId: 'OAPIL-1', person: 'Priya', date: '2026-08-05', hours: 4, activity: 'Investigation', billable: true, note: '', now: NOW } as Action,
      priya,
    )
    const entryId = Object.values(withHours.timeEntries).find((e) => e.date === '2026-08-05')!.id

    const submittedState = okAs(
      withHours,
      { t: 'submitTimesheet', person: 'Priya', weekStarting: week, now: NOW } as Action,
      priya,
    )

    /* Inside the week: all three arms refuse, and the message names the week and the way out. */
    const addInside = actAs(submittedState, { t: 'addTime', issueId: 'OAPIL-1', person: 'Priya', date: '2026-08-06', hours: 2, activity: 'Investigation', billable: true, note: '', now: NOW } as Action, priya)
    const editInside = actAs(submittedState, { t: 'updateTime', id: entryId, patch: { hours: 6 }, now: NOW } as Action, priya)
    const removeInside = actAs(submittedState, { t: 'removeTime', id: entryId, now: NOW } as Action, priya)

    /* The trap the plan names: escaping the week by moving the date out of it. */
    const escapeByDate = actAs(submittedState, { t: 'updateTime', id: entryId, patch: { date: '2026-08-12' }, now: NOW } as Action, priya)

    /* Outside the week, another person, and another week: all still open. */
    const addNextWeek = actAs(submittedState, { t: 'addTime', issueId: 'OAPIL-1', person: 'Priya', date: '2026-08-12', hours: 3, activity: 'Investigation', billable: true, note: '', now: NOW } as Action, priya)
    const addOtherPerson = actAs(submittedState, { t: 'addTime', issueId: 'OAPIL-1', person: 'Nishant', date: '2026-08-05', hours: 3, activity: 'Investigation', billable: true, note: '', now: NOW } as Action, lead)

    /* And after the week is returned, the person can fix it — the whole point of returning it. */
    const sheetId = Object.values(submittedState.timesheets)[0]!.id
    const returned = okAs(
      submittedState,
      { t: 'decideTimesheet', id: sheetId, decision: 'rejected', reason: 'Thursday is on the wrong issue.', now: NOW } as Action,
      lead,
    )
    const editAfterReturn = actAs(returned, { t: 'updateTime', id: entryId, patch: { hours: 6 }, now: NOW } as Action, priya)

    /* Approved is frozen too, and says so differently. */
    const resubmitted = okAs(returned, { t: 'submitTimesheet', person: 'Priya', weekStarting: week, now: NOW } as Action, priya)
    const approved = okAs(resubmitted, { t: 'decideTimesheet', id: sheetId, decision: 'approved', now: NOW } as Action, lead)
    const editAfterApproval = actAs(approved, { t: 'updateTime', id: entryId, patch: { hours: 7 }, now: NOW } as Action, priya)

    /* Self-approval is refused through the reducer, not only in the pure rule. */
    const selfDecide = actAs(resubmitted, { t: 'decideTimesheet', id: sheetId, decision: 'approved', now: NOW } as Action, priya)

    const refused = (r: { error?: string }) => Boolean(r.error)
    const good =
      refused(addInside) &&
      refused(editInside) &&
      refused(removeInside) &&
      refused(escapeByDate) &&
      !refused(addNextWeek) &&
      !refused(addOtherPerson) &&
      !refused(editAfterReturn) &&
      refused(editAfterApproval) &&
      refused(selfDecide) &&
      /awaiting approval/.test(addInside.error ?? '') &&
      /approved/.test(editAfterApproval.error ?? '') &&
      approved.timesheets[sheetId]!.status === 'Approved' &&
      returned.timesheets[sheetId]!.reason === 'Thursday is on the wrong issue.'

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `Once the ${weekLabel(week)} is submitted, all three time arms refuse inside it: "${(addInside.error ?? '').slice(0, 74)}". Moving an entry OUT of the week is refused too — the check reads the stored date and, when a patch moves it, the destination as well, so an hour cannot walk out of a week somebody has attested to by editing the one field the freeze exists to hold. Everything else stays open: the next week, another person, and the same entry once the week is returned. Approved freezes again and says so differently ("${(editAfterApproval.error ?? '').slice(0, 52)}"), because "awaiting approval" and "already approved" call for different next moves. A rejection carries its reason on the row, and the person who submitted cannot approve their own week even holding the grant.`,
      stops: 'nowhere in the rules, and nowhere in storage either — the Timesheet table landed in the commit after this scenario was written, and the persistence proof drives a submitted week through Postgres and finds the freeze still holding. What no check here opens is the screen.',
      severity: '—',
      impact:
        'The freeze is the point of the feature: without it an approver signs off a number that can change underneath them. Both directions are asserted, because a guard that only refuses is indistinguishable from a broken feature.',
    }
  },
)

scenario(
  'W',
  'A notification fails to deliver',
  'The failure is visible and recorded — a silent non-delivery is the dangerous case.',
  () => {
    const lead = Object.values(BASE.model.people).find((p) => p.name === 'Priya')!
    const staffed = ok(BASE, {
      t: 'config', op: { k: 'upsertPerson', id: lead.id, name: 'Priya', roleIds: ['ROLE_ENGAGEMENT_LEAD'] }, now: NOW,
    } as Action)

    const byEmail = ok(staffed, {
      t: 'config',
      op: {
        k: 'setAutomationRules',
        rules: [
          {
            id: 'AUTO_EMAIL', label: 'Email the lead', on: 'issue.owner', when: [], enabled: true,
            then: [{ kind: 'notify', audience: 'role:ROLE_ENGAGEMENT_LEAD', channel: 'email', text: '{id} is now {to}\u2019s' },
            ],
          },
        ],
      },
      now: NOW,
    } as Action)

    const run = applyWithRules(
      byEmail,
      { t: 'updateIssue', id: 'OAPIL-1', patch: { owner: 'Sam' }, now: NOW } as Action,
      A,
    )
    const message = Object.values(run.state.notifications)[0]
    const stuck = undelivered(run.state.notifications)

    const good = Boolean(message) && message.delivery === 'pending' && stuck.length === 1
    return {
      verdict: good ? 'PARTIAL' : 'FAIL',
      actual: `The message is recorded with an outcome rather than attempted and lost: delivery is "${message?.delivery}" because "${message?.deliveryNote}" The count of undelivered messages is shown in the inbox and on the automation screen to everybody, rather than hidden behind a setting — a firm that configured email escalation and has never sent one should not discover it from a client asking why nobody called.`,
      stops: 'at the transport — in-app is delivered because the inbox is the delivery; email and Teams have nowhere to go',
      severity: 'P1',
      impact: 'Non-delivery is visible and counted. It is still non-delivery: nothing leaves the building.',
    }
  },
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
  'The run stops safely, what did happen is visible, and the failure is recorded rather than swallowed.',
  () => {
    /* Somebody who will receive things, and a rule that will fail. */
    const lead = Object.values(BASE.model.people).find((p) => p.name === 'Priya')!
    const staffed = ok(BASE, {
      t: 'config', op: { k: 'upsertPerson', id: lead.id, name: 'Priya', roleIds: ['ROLE_ENGAGEMENT_LEAD'] }, now: NOW,
    } as Action)

    /* A rule with two steps: one that works, one the reducer will refuse. */
    const twoStep = ok(staffed, {
      t: 'config',
      op: {
        k: 'setAutomationRules',
        rules: [
          {
            id: 'AUTO_TEST', label: 'Two steps, one impossible', on: 'issue.owner',
            when: [], enabled: true,
            then: [
              { kind: 'notify', audience: 'role:ROLE_ENGAGEMENT_LEAD', channel: 'in-app', text: '{id} moved to {to}' },
              // Refused: the transition graph does not allow Open → Closed - confirmed, and a
              // rule is bound by it exactly as a person is.
              { kind: 'requestApproval', ruleId: 'NO_SUCH_RULE', text: '' },
            ],
          },
        ],
      },
      now: NOW,
    } as Action)

    const run = applyWithRules(
      twoStep,
      { t: 'updateIssue', id: 'OAPIL-1', patch: { owner: 'Sam' }, now: NOW } as Action,
      A,
    )

    const raised = Object.values(run.state.notifications).length
    const refused = run.automation.refusals.length
    const stateIsWhole = run.state.issues['OAPIL-1'].owner === 'Sam'

    /* And a rule that reaches nobody reports it rather than looking like it worked. */
    const orphanAudience = ok(staffed, {
      t: 'config',
      op: {
        k: 'setAutomationRules',
        rules: [
          {
            id: 'AUTO_ORPHAN', label: 'Tell a role nobody holds', on: 'issue.owner',
            when: [], enabled: true,
            then: [{ kind: 'notify', audience: 'role:ROLE_CLIENT_SPONSOR', channel: 'in-app', text: 'x' }],
          },
        ],
      },
      now: NOW,
    } as Action)
    const missed = applyWithRules(
      orphanAudience,
      { t: 'updateIssue', id: 'OAPIL-1', patch: { owner: 'Sam' }, now: NOW } as Action,
      A,
    )

    const good = raised === 1 && refused === 1 && stateIsWhole && missed.automation.misses.length === 1
    return {
      verdict: good ? 'PARTIAL' : 'FAIL',
      actual: `The working step ran and the impossible one did not: ${raised} notification raised, ${refused} step refused ("${run.automation.refusals[0]?.error}"), and the original change stands. A rule addressed to a role nobody holds reports it — "${missed.automation.misses[0]?.why}" — rather than looking like it worked. Rules act by dispatching ordinary actions, so a rule cannot do anything a person could not, and everything it does is in the trail with the rule that caused it.`,
      stops: 'at the schedule — every rule reacts to something that happened, so "every morning, escalate what is about to breach" cannot be expressed',
      severity: 'P2',
      impact: 'Event-driven automation works and fails safely. Time-driven automation needs a clock and a process to run it, and this application has neither.',
    }
  },
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
    /*
     * Two deliveries of the same work, which is a normal event rather than a contrived one.
     * A tab going away flushes its queue over `sendBeacon` because `fetch` is cancelled on
     * unload, and that beacon can carry a slice a live request is already carrying.
     */
    const note = (body: string, key: string) => ({
      t: 'addNote', issueId: 'OAPIL-1', body, noteType: 'General Update',
      pinned: false, now: NOW, key,
    } as SubmittedAction)

    const a = note('Note A', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')
    const b = note('Note B', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb')
    const c = note('Note C', 'cccccccc-3333-4333-8333-cccccccccccc')
    const d = note('Note D', 'dddddddd-4444-4444-8444-dddddddddddd')

    const countNotes = (st: WorkspaceState) =>
      Object.values(st.notes).filter((n) => n.body.startsWith('Note ')).length

    const applyAll = (st: WorkspaceState, items: { action: Action }[]) =>
      items.reduce((acc, i) => ok(acc, i.action), st)

    /* First delivery: nothing has been seen, so all three apply. */
    const first = split([a, b, c], new Set<string>())
    const afterFirst = applyAll(BASE, first.planned)

    /*
     * The beacon then fires carrying the same three plus one more typed in the meantime.
     * This is the exact overlap a request-level key would miss: it is a genuinely different
     * request, so its own id would differ, and every action in the overlap would apply twice.
     */
    const recorded = new Set(first.record)
    const second = split([a, b, c, d], recorded)
    const afterSecond = applyAll(afterFirst, second.planned)

    /* The same action with its key removed, rather than set to undefined — which is still a key. */
    const stripped = ({ key, ...rest }: SubmittedAction) => rest as Action

    /* What the same second delivery does with no key at all — the behaviour being fixed. */
    const unprotected = [a, b, c, d].reduce((acc, x) => ok(acc, stripped(x)), afterFirst)

    /* A key repeated inside one batch is collapsed, so the insert cannot trip over itself. */
    const withinBatch = split([a, a], new Set<string>())

    /* Unkeyed actions always apply: intake and the scheduled pass write without one. */
    const unkeyed = split([stripped(a) as SubmittedAction], recorded)

    /* And a key of the wrong shape is refused rather than quietly ignored. */
    /*
     * And the half no pure function can show: the transaction that reads the recorded keys,
     * folds, and writes the new ones — all inside one serializable transaction, so a
     * redelivery cannot interleave its way past the check. Cited from a real run.
     */
    const proof = readProof()
    const redelivery = Boolean(
      proof &&
        proof.checks.some((c) => c.ok && c.what.startsWith('a re-delivered batch writes nothing')) &&
        proof.checks.some((c) => c.ok && c.what.startsWith('and the keys are stored')) &&
        proof.checks.some((c) => c.ok && c.what.startsWith('a refused keyed batch names')),
    )

    const badKeys = ['', 'short', 42, 'has spaces', 'x'.repeat(MAX_KEY_LENGTH + 1)]
      .every((k) => keyProblem(k) !== null)
    const goodKey = keyProblem(a.key) === null

    const good =
      countNotes(afterFirst) === 3 &&
      second.planned.length === 1 &&
      second.skipped.length === 3 &&
      countNotes(afterSecond) === 4 &&
      countNotes(unprotected) === 7 &&
      withinBatch.planned.length === 1 &&
      withinBatch.record.length === 1 &&
      unkeyed.planned.length === 1 &&
      badKeys &&
      goodKey

    return {
      verdict: good && redelivery ? 'PASS' : good ? 'PARTIAL' : 'FAIL',
      actual: `Three writes are delivered, then re-delivered with a fourth appended — the overlap a closing tab produces. The second delivery applies ${second.planned.length} and recognises ${second.skipped.length} as already done, leaving ${countNotes(afterSecond)} notes. Without the key the same delivery leaves ${countNotes(unprotected)}. A key repeated inside one batch collapses to one, an unkeyed action always applies — intake and the scheduled pass write without one — and a malformed key is refused at the route rather than dropped, so protection can never be silently off. ${redelivery ? `Against Postgres on ${proof!.at.slice(0, 10)}: the same batch delivered twice left the second delivery writing nothing, the keys are stored so the skip survives a restart, and a refused keyed batch named exactly the key that committed.` : 'What is proven here is the decision, not the round trip: the transaction that reads the recorded keys and writes them back has not been run against Postgres.'}`,
      stops: redelivery ? '—' : 'at the transaction, which no database has yet executed',
      severity: redelivery ? '—' : 'P2',
      impact:
        'Hiding a tab mid-save no longer duplicates notes, evidence and dependencies. The rule is proven; the storage behind it is still unexercised, like every other database claim in this repository.',
    }
  },
)

scenario(
  'HV1',
  'A working pattern changes, and last quarter still has to add up',
  'What was true is preserved with its period, and a later correction cannot move a figure already computed.',
  () => {
    /*
     * Driven against lib/versioning.ts directly, before it has a caller. Boundary arithmetic is
     * where this kind of code goes wrong and it goes wrong quietly, so it is proven here rather
     * than inferred from a capacity figure looking plausible.
     */
    const v = (id: string, from: string, to: string | null, hours: number): Version<number> => ({
      id, subjectKind: 'person.workingPattern', subjectId: 'P1', validFrom: from, validTo: to,
      value: hours, recordedAt: NOW, by: 'Operator', reason: 'Recorded for the test',
    })
    const timeline = [v('ver-1', '2026-01-01', '2026-07-01', 7.5), v('ver-2', '2026-07-01', null, 6)]
    const on = (d: string) => valueAt(timeline, 'person.workingPattern', 'P1', d)

    /*
     * The null case first, deliberately. It is the property everything else rests on, and the
     * tempting fix — falling back to the current value when nothing covers a date — would still
     * return a plausible number while destroying the reason this exists.
     */
    const beforeAnything = on('2025-12-31')
    const unknownPerson = valueAt(timeline, 'person.workingPattern', 'P9', '2026-03-01')

    const inside = on('2026-03-01')
    const dayBefore = on('2026-06-30')
    const onBoundary = on('2026-07-01')
    const openEnded = on('2027-05-05')

    /* Overlaps refused, gaps and abutting periods allowed. */
    const subject = { subjectKind: 'person.workingPattern', subjectId: 'P1' }
    const overlapping = overlapProblem(timeline, { ...subject, validFrom: '2026-05-01', validTo: '2026-08-01' })
    const abutting = overlapProblem([timeline[0]], { ...subject, validFrom: '2026-07-01', validTo: null })
    const gapped = overlapProblem([timeline[0]], { ...subject, validFrom: '2026-09-01', validTo: null })
    const backwards = overlapProblem([], { ...subject, validFrom: '2026-06-01', validTo: '2026-01-01' })
    const correctingItself = overlapProblem(timeline, { ...subject, id: 'ver-1', validFrom: '2026-01-15', validTo: '2026-07-01' })

    /* A correction reports what was computed from the version, and moves none of it. */
    const stamps = [
      { stampedFrom: 'ver-1', describes: 'the week of 2 Mar, approved' },
      { stampedFrom: 'ver-2', describes: 'the week of 6 Jul' },
    ]
    const affected = correctionImpact(stamps, 'ver-1')
    const held = stamp(inside, NOW)
    const stillSevenAndAHalf = held?.value === 7.5 && held.stampedFrom === 'ver-1'

    const good =
      beforeAnything === null &&
      unknownPerson === null &&
      inside?.value === 7.5 &&
      dayBefore?.value === 7.5 &&
      onBoundary?.value === 6 &&
      openEnded?.value === 6 &&
      Boolean(overlapping) &&
      abutting === null &&
      gapped === null &&
      Boolean(backwards) &&
      correctingItself === null &&
      affected.length === 1 &&
      stillSevenAndAHalf

    return {
      verdict: good ? 'PARTIAL' : 'FAIL',
      actual: `A date before any period returns null rather than a default, and so does a person nobody has a pattern for — which is the property the rest rests on, because a fallback would still return a plausible number. \`validTo\` is exclusive: 30 June answers ${dayBefore?.value}h and 1 July answers ${onBoundary?.value}h, so two periods can abut without overlapping. An overlap is refused — "${(overlapping ?? '').slice(0, 70)}…" — while a gap is allowed, because somebody who left and rejoined has one and forcing contiguity would invent employment. Correcting a period against itself is permitted. A correction reports the ${affected.length} record computed from that version and moves none of it: the stamp still holds ${held?.value}h from ${held?.stampedFrom}. What is not proven is the round trip — no version has been stored, and nothing in the application stamps anything yet, because the first thing that will is an approved timesheet.`,
      stops: 'at storage, and at a stamp made by the application rather than by this scenario',
      severity: 'P2',
      impact:
        'The rules hold. Until they are wired to capacity and persisted, a working pattern is still a single value that a change destroys.',
    }
  },
)

scenario(
  'TW1',
  'A consultant records time against work that has run past its due date',
  'The overrun warns and never refuses; only a closed issue shuts the window, and a derived opening date says it was derived.',
  () => {
    /*
     * Driven against lib/timeWindow.ts directly, before `addTime` consults it. That is
     * deliberate: this rule is the first thing that will ever refuse a time entry, and the
     * person it lands on is a consultant at the end of a week with hours to record. A refusal
     * that fires on the common case — every issue that runs past its due date — would turn the
     * extension flow into a formality people click through.
     */
    const issue = (over: Partial<WindowIssue> = {}): WindowIssue => ({
      id: 'OAPIL-1', status: 'In Progress', owner: 'Priya',
      raised: '2026-08-03', plannedStart: null, plannedEnd: '2026-08-10', ...over,
    })
    const priya: WindowPerson = { name: 'Priya', permissions: ['time.record'] }
    const sam: WindowPerson = { name: 'Sam', permissions: ['time.record'] }
    const lead: WindowPerson = { name: 'Sam', permissions: ['time.record', 'time.recordForOthers'] }

    /*
     * The absent case first, deliberately. An issue with no planned start still has a window,
     * and the whole question is whether the window admits where its date came from: a fallback
     * presented as a plan is the defect, not the fallback itself.
     */
    const fellBack = windowOpening(issue())
    const stated = windowOpening(issue({ plannedStart: '2026-08-05' }))

    const pastDue = timeEntryAllowed(issue(), priya, '2026-08-13', 'none')
    const closed = timeEntryAllowed(issue({ status: 'Closed - confirmed' }), priya, '2026-08-13', 'none')
    const before = timeEntryAllowed(issue(), priya, '2026-07-20', 'none')
    /* The opening date itself is inside the window — the comparison is strict for a reason. */
    const onOpening = timeEntryAllowed(issue(), priya, '2026-08-03', 'none')
    const others = timeEntryAllowed(issue(), sam, '2026-08-13', 'none')
    const withPermission = timeEntryAllowed(issue(), lead, '2026-08-13', 'none')
    /* A submitted week freezes; a returned one is editable again, which is why it was returned. */
    const frozen = timeEntryAllowed(issue(), priya, '2026-08-13', 'submitted')
    const returned = timeEntryAllowed(issue(), priya, '2026-08-13', 'rejected')

    const good =
      fellBack.source === 'default' &&
      fellBack.date === '2026-08-03' &&
      fellBack.because.includes('no start date set') &&
      stated.source === 'stated' &&
      stated.date === '2026-08-05' &&
      pastDue.kind === 'allowed' &&
      !refusesTimeEntry(pastDue) &&
      pastDue.warnings.length === 1 &&
      pastDue.warnings[0].startsWith('Logged 3 days after the due date') &&
      pastDue.opening.source === 'default' &&
      closed.kind === 'issue-closed' &&
      refusesTimeEntry(closed) &&
      closed.message.includes('extension') &&
      before.kind === 'before-window' &&
      onOpening.kind === 'allowed' &&
      others.kind === 'not-permitted' &&
      others.message.includes('time.recordForOthers') &&
      withPermission.kind === 'allowed' &&
      frozen.kind === 'week-frozen' &&
      returned.kind === 'allowed' &&
      timeEntryNote(pastDue) !== undefined &&
      timeEntryNote(onOpening) === undefined

    return {
      verdict: good ? 'PARTIAL' : 'FAIL',
      actual: `Three days past the due date and still open, the entry is allowed and carries a warning — "${pastDue.warnings[0] ?? ''}" — rather than a refusal, because a control that fires on every overrunning issue stops being a control. The window shuts when the issue does: a closed record refuses and names the route, "${closed.message.split('. ').slice(-1)[0]}". The opening date is ${fellBack.date} with provenance \`${fellBack.source}\` and the words "${fellBack.because}", so a window derived from the raised date can never be read as a plan somebody set; a recorded start date reports \`${stated.source}\` instead. A day before the window is refused, the opening day itself is not. Somebody else's hours refuse without \`time.recordForOthers\` and are allowed with it — the design writes that permission \`time.logForOthers\`, which does not exist, so the real key is used. A submitted week is frozen and a returned one is editable again. Nothing calls any of this yet: \`addTime\` still always succeeds.`,
      stops: 'at addTime, which does not consult the window rule yet — step 4 of the design, and the one carrying the regression risk',
      severity: 'P2',
      impact:
        'The rule is provable and arguable before a single consultant meets it. Until it is wired in, time can still be logged against a closed issue.',
    }
  },
)

scenario(
  'TW2',
  "A daily cap is checked against a working pattern nobody recorded",
  'The cap is reported unenforced rather than defaulted to eight, and a late entry has to explain itself only past the allowance.',
  () => {
    const pattern = (id: string, from: string, to: string | null, value: unknown): Version<unknown> => ({
      id, subjectKind: 'person.workingPattern', subjectId: 'P1', validFrom: from, validTo: to,
      value, recordedAt: NOW, by: 'Operator', reason: 'Recorded for the test',
    })
    const timeline = [
      pattern('ver-7', '2026-01-01', '2026-07-01', { hoursPerDay: 7.5 }),
      pattern('ver-8', '2026-07-01', null, { hoursPerDay: 6 }),
    ]

    /*
     * Every unknown first. `valueAt` answering null is the property the rest rests on, and the
     * tempting repair — defaulting to eight — would still produce a plausible number while
     * checking a consultant's day against a working week nobody entered.
     */
    const beforeAnything = dailyCap(timeline, 'P1', '2025-12-31')
    const unknownPerson = dailyCap(timeline, 'P9', '2026-06-30')
    /*
     * And the second unknown, which the rule as written does not mention: `recordVersion` types
     * a version's value as opaque, so a version can exist and carry nothing usable. That is not
     * a zero-hour day.
     */
    const shapeless = dailyCap(
      [{ ...pattern('ver-9', '2026-01-01', null, { daysPerWeek: 4 }), subjectId: 'P2' }],
      'P2',
      '2026-06-01',
    )
    const noWarningWithoutACap = dailyCapWarning(beforeAnything, 11)

    /* Then the cap that is known — and known *as at the work date*, not as at today. */
    const june = dailyCap(timeline, 'P1', '2026-06-30')
    const july = dailyCap(timeline, 'P1', '2026-07-01')
    const longDay = dailyCapWarning(june, 11)
    const ordinaryDay = dailyCapWarning(june, 7.5)

    /*
     * Backdating, at the boundary in both directions. `daysBetween` is inclusive — same day is
     * one — so the difference is a subtraction away from being silently a day out.
     */
    const sameDay = backdated('2026-08-01', '2026-08-01')
    const atAllowance = backdated('2026-08-01', '2026-08-08')
    const pastAllowance = backdated('2026-08-01', '2026-08-09')

    const good =
      beforeAnything.kind === 'unenforced' &&
      beforeAnything.hoursPerDay === null &&
      unknownPerson.kind === 'unenforced' &&
      unknownPerson.hoursPerDay === null &&
      shapeless.kind === 'unenforced' &&
      shapeless.hoursPerDay === null &&
      shapeless.fromVersion === 'ver-9' &&
      noWarningWithoutACap === null &&
      june.kind === 'enforced' &&
      june.hoursPerDay === 7.5 &&
      june.fromVersion === 'ver-7' &&
      july.hoursPerDay === 6 &&
      july.fromVersion === 'ver-8' &&
      longDay !== null &&
      ordinaryDay === null &&
      sameDay.days === 0 &&
      !sameDay.backdated &&
      atAllowance.days === BACKDATING_ALLOWANCE_DAYS &&
      !atAllowance.backdated &&
      atAllowance.message === null &&
      pastAllowance.days === BACKDATING_ALLOWANCE_DAYS + 1 &&
      pastAllowance.backdated &&
      pastAllowance.justificationRequired &&
      pastAllowance.approvalRequired

    return {
      verdict: good ? 'PARTIAL' : 'FAIL',
      actual: `A date before any pattern, a person nobody has a pattern for, and a version whose value carries no hours per day all answer unenforced with a null cap — three ways of not knowing, none of them eight. An unenforced cap warns about nothing, so an eleven-hour day is recorded rather than argued with. Where a pattern exists the cap is read at the work date, not at today: 30 June is ${june.hoursPerDay}h from ${june.fromVersion} and 1 July is ${july.hoursPerDay}h from ${july.fromVersion}, so hours logged in June are checked against June even after a move to a four-day week. Eleven hours against a ${june.hoursPerDay}h day warns and does not refuse — long days happen, and refusing one produces hours booked to the wrong day rather than fewer hours worked. Backdating turns at exactly ${BACKDATING_ALLOWANCE_DAYS} days: ${atAllowance.days} days late needs nothing, ${pastAllowance.days} days late needs a justification and an approval. No cap is applied by anything, and no working pattern has been recorded as a version by the application.`,
      stops: 'at addTime and at the versions table — nothing records a working pattern as a version yet, so every real cap today would be unenforced',
      severity: 'P2',
      impact:
        'The honest answer is available. Until patterns are versioned and the cap is called, a daily total is unchecked — which is better than checked against a number nobody entered.',
    }
  },
)

scenario(
  'AU3',
  'A person signs in and is sent back to an address that exists',
  'Sign-in and sign-out return the browser to the public address somebody typed, not to whatever this process answers on.',
  () => {
    /*
     * This is the check that was missing when it mattered.
     *
     * Sign-in worked, the token was exchanged, the session cookie was issued — and the browser
     * was then redirected to `https://cd04369db00c:8080/`, the container's own address behind
     * App Service. Login and logout both ended on an error page for every user, and nothing in
     * this suite, the type system or the build noticed, because from inside the process the code
     * was correct: `new URL('/', req.url)` is exactly right when nothing sits in front of you.
     *
     * It was found by reading a `Location` header from the deployed site. So the property under
     * test is not "a redirect is produced" but "the redirect names the address the browser can
     * actually reach", and the fixture is a request shaped the way a proxy delivers one.
     */
    const proxied = new Request('https://cd04369db00c:8080/api/auth/signout', {
      method: 'POST',
      headers: {
        'x-forwarded-host': 'axiomate-tms.azurewebsites.net',
        'x-forwarded-proto': 'https',
      },
    })
    const behindProxy = publicOrigin(proxied)

    /* Two proxies deep. The first entry is the client's own view and the only reachable one. */
    const chained = publicOrigin(
      new Request('https://internal:8080/api/auth/signout', {
        method: 'POST',
        headers: {
          'x-forwarded-host': 'axiomate-tms.azurewebsites.net, internal-gateway',
          'x-forwarded-proto': 'https, http',
        },
      }),
    )

    /*
     * No forwarded headers. The configured Entra redirect URI is the fallback, and it is a
     * trustworthy one: Entra refuses any redirect that is not registered, so a deployment where
     * this is wrong cannot sign anybody in — it cannot be quietly wrong here either.
     */
    const before = process.env.AXIOMATE_ENTRA_REDIRECT_URI
    process.env.AXIOMATE_ENTRA_REDIRECT_URI = 'https://axiomate-tms.azurewebsites.net/api/auth/callback'
    const fromConfig = publicOrigin(new Request('https://cd04369db00c:8080/api/auth/signout', { method: 'POST' }))

    /* And with neither, local development, where the request's own origin is correct. */
    delete process.env.AXIOMATE_ENTRA_REDIRECT_URI
    const local = publicOrigin(new Request('http://localhost:3000/api/auth/signout', { method: 'POST' }))
    if (before === undefined) delete process.env.AXIOMATE_ENTRA_REDIRECT_URI
    else process.env.AXIOMATE_ENTRA_REDIRECT_URI = before

    const container = 'https://cd04369db00c:8080'
    const good =
      behindProxy === 'https://axiomate-tms.azurewebsites.net' &&
      chained === 'https://axiomate-tms.azurewebsites.net' &&
      fromConfig === 'https://axiomate-tms.azurewebsites.net' &&
      local === 'http://localhost:3000'

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `A request delivered to the container at ${container} with the proxy's own headers resolves to ${behindProxy}, which is where the browser came from. Two proxies deep it still takes the client's view (${chained}) rather than the gateway's. With no forwarded headers it falls back to the configured Entra redirect URI (${fromConfig}) — trustworthy because Entra refuses an unregistered redirect, so a deployment that gets this wrong cannot sign anybody in. With neither, on a developer's machine, the request's own origin is correct and is used (${local}). The Secure flag on the session cookie is decided from the same origin, so it is now a fact about the address the browser used rather than about an internal one.`,
      stops: 'nowhere — but only the origin is proven here; that the deployed site sends the forwarded header is a property of App Service, verified by reading a Location header from the running site',
      // No severity: it passes, and severity in this harness describes the cost of a gap. It
      // was P1 while it was broken, which is the point of writing it down rather than fixing
      // the code and moving on.
      severity: '—',
      impact:
        'Sign-in and sign-out both ended on a browser error page for every user, and every check inside the process passed. A redirect is only correct relative to something outside the process, which is why this asserts against a proxied request rather than a plain one.',
    }
  },
)

scenario(
  'HV2',
  'Capacity is computed against the working week in force at the time',
  'A period is checked against the pattern recorded for it, and a figure resting on an assumption says so.',
  () => {
    const P = 'PERSON_X'
    const pattern = (id: string, from: string, to: string | null, value: unknown): Version<unknown> => ({
      id, subjectKind: 'person.workingPattern', subjectId: P, validFrom: from, validTo: to,
      value, recordedAt: NOW, by: 'Operator', reason: 'Recorded for the test',
    })
    const timeline = [
      pattern('ver-a', '2026-04-01', '2026-07-01', { hoursPerDay: 8, daysPerWeek: 5 }),
      pattern('ver-b', '2026-07-01', null, { hoursPerDay: 6, daysPerWeek: 4 }),
    ]
    const stored = { [P]: { personId: P, hoursPerDay: 7.5, daysPerWeek: 5, billableTargetPct: 80, source: 'default' as const } }

    /*
     * The unknown first, because it is the property the whole mechanism exists to provide and
     * the one a re-default would silently destroy.
     */
    const beforeAnything = profileAt(timeline, stored, P, '2026-03-31')
    const noProfileNoVersion = profileAt(timeline, {}, 'PERSON_NOBODY', '2026-05-01')

    /* Then the pattern in force, read AT THE DATE rather than as it stands today. */
    const inApril = profileAt(timeline, stored, P, '2026-04-15')
    const inJuly = profileAt(timeline, stored, P, '2026-07-15')

    /* A version whose value carries nothing usable is not a zero-hour day. */
    const shapeless = profileAt(
      [{ ...pattern('ver-c', '2026-04-01', null, { note: 'nothing usable' }), subjectId: 'PERSON_Y' }],
      { PERSON_Y: { ...stored[P], personId: 'PERSON_Y' } },
      'PERSON_Y',
      '2026-05-01',
    )

    /* And the whole map at once, which is the shape planCheck already takes. */
    const map = profilesAt(timeline, stored, '2026-07-15')

    /*
     * The number, and what it rests on. `capacityFor` must answer — it is what refuses an
     * overallocation — so the null does not propagate. The PROVENANCE does.
     */
    const alloc = [{ id: 'a1', person: 'X', projectId: 'p', startDate: '2026-07-06', endDate: '2026-07-10', percentage: 100, note: '', createdBy: 'x', createdAt: NOW, deletedAt: null }]
    const onStated = capacityFor('X', inJuly, [], alloc, '2026-07-06', '2026-07-10')
    const onAssumed = capacityFor('X', beforeAnything, [], alloc, '2026-03-23', '2026-03-27')
    const said = describeCapacity(onAssumed)
    const notSaid = describeCapacity(onStated)

    const good =
      /* nothing recorded for that date falls back to the stored profile, which says it is a default */
      beforeAnything?.source === 'default' &&
      beforeAnything?.hoursPerDay === 7.5 &&
      noProfileNoVersion === undefined &&
      /* the version in force wins, and is marked stated */
      inApril?.hoursPerDay === 8 &&
      inApril?.daysPerWeek === 5 &&
      inApril?.source === 'stated' &&
      inJuly?.hoursPerDay === 6 &&
      inJuly?.daysPerWeek === 4 &&
      inJuly?.source === 'stated' &&
      /* an unusable value resolves to what was stored rather than to zero */
      shapeless?.hoursPerDay === 7.5 &&
      shapeless?.source === 'default' &&
      map[P]?.hoursPerDay === 6 &&
      /* and the basis travels with the number */
      onStated.basis === 'stated' &&
      onAssumed.basis === 'default' &&
      /assumed/i.test(said) &&
      !/assumed/i.test(notSaid)

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `A date before anything was recorded resolves to the stored profile, which reports itself as a ${beforeAnything?.source} — NOT to a version that does not exist, and not to a fabricated eight. Where a pattern is in force it wins and is marked stated, read at the work date rather than at today: April is ${inApril?.hoursPerDay}h over ${inApril?.daysPerWeek} days, July is ${inJuly?.hoursPerDay}h over ${inJuly?.daysPerWeek}, so an allocation running in April is checked against April even after a move to a four-day week. A version whose value carries no usable hours resolves to the stored profile rather than a zero-hour day. Somebody with neither a profile nor a version resolves to nothing at all. The null does not propagate into capacityFor — it must answer, because it is what refuses an overallocation — so the PROVENANCE does instead: position.basis is ${onStated.basis} against a recorded pattern and ${onAssumed.basis} against an assumed one, and describeCapacity says so out loud in the second case and not the first.`,
      stops: 'nowhere for the working pattern. A pattern that changes mid-allocation is read at the START of the window rather than splitting it — that is a different feature, and it would change what capacityFor returns rather than how it is called',
      severity: '—',
      impact:
        'A capacity figure computed from an assumed working week is not wrong, but it is a different claim from one computed from a confirmed week — and the difference now travels with the number instead of being lost the moment it is quoted.',
    }
  },
)

scenario(
  'RT1',
  'A cost is computed from the rate in force on the day the work was done',
  'Hours are priced at their own date, an unrated hour makes the total absent rather than smaller, and nobody without the grant is sent a rate at all.',
  () => {
    const P = 'PERSON_R'
    const rate = (id: string, kind: 'cost' | 'bill', from: string, to: string | null, amount: number, currency = 'GBP'): PersonRate => ({
      id, personId: P, kind, validFrom: from, validTo: to, amount, currency,
      recordedAt: NOW, by: 'Operator', reason: 'Recorded for the test',
    })
    const rates = [
      rate('r1', 'cost', '2026-01-01', '2026-07-01', 40),
      rate('r2', 'cost', '2026-07-01', null, 50),
      rate('r3', 'bill', '2026-01-01', null, 100),
    ]

    /* The unknown first — a date before anything was recorded has no rate, and does not fall back. */
    const beforeAnything = rateAt(rates, P, 'cost', '2025-12-31')
    const unknownPerson = rateAt(rates, P + 'X', 'cost', '2026-03-01')

    /* Then the rate in force, read AT THE WORK DATE rather than at today. */
    const inMarch = rateAt(rates, P, 'cost', '2026-03-01')
    const inAugust = rateAt(rates, P, 'cost', '2026-08-01')

    /* Cost and bill move independently — that is why they are rows and not columns. */
    const billInAugust = rateAt(rates, P, 'bill', '2026-08-01')

    /* A margin over two periods, priced day by day. */
    const complete = costOf(rates, [
      { personId: P, date: '2026-03-02', hours: 10 },  // 40 cost / 100 bill
      { personId: P, date: '2026-08-03', hours: 10 },  // 50 cost / 100 bill
    ])

    /* One unrated hour and the WHOLE total is absent, with the hole named. */
    const holed = costOf(rates, [
      { personId: P, date: '2026-03-02', hours: 10 },
      { personId: P, date: '2025-11-01', hours: 4 },   // before any rate
    ])

    /* Mixed currencies cannot be summed without a conversion nobody recorded. */
    const mixed = costOf(
      [...rates, rate('r4', 'cost', '2026-01-01', null, 60, 'USD')].filter((r) => r.id !== 'r1'),
      [{ personId: P, date: '2026-03-02', hours: 5 }],
    )

    /* Overlaps are refused by the same machinery `Version` uses, not a second copy of it. */
    const overlap = rateProblem(rates, { personId: P, kind: 'cost', validFrom: '2026-06-01', validTo: null })
    const abutting = rateProblem(rates, { personId: P, kind: 'bill', validFrom: '2025-06-01', validTo: '2026-01-01' })

    const good =
      beforeAnything === null &&
      unknownPerson === null &&
      inMarch?.amount === 40 &&
      inAugust?.amount === 50 &&
      billInAugust?.amount === 100 &&
      complete.cost === 900 &&
      complete.revenue === 2000 &&
      complete.margin === 1100 &&
      complete.unratedHours === 0 &&
      holed.cost === null &&
      holed.margin === null &&
      holed.unratedHours === 4 &&
      holed.hours === 14 &&
      /no rate on the day/.test(describeCost(holed)) &&
      mixed.cost === null &&
      overlap !== null &&
      abutting === null

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `A date before any rate answers null and does NOT fall back — there is no defensible shipped rate for a person, so unlike a working pattern this one cannot default and label the default. Where a rate is in force it is read at the WORK date: 2 March costs ${inMarch?.amount} and 3 August costs ${inAugust?.amount}, so a pay rise in July does not retrospectively change what March cost. Cost and bill are separate rows and move independently. Twenty hours across the two periods come to ${complete.cost} cost against ${complete.revenue} billed — margin ${complete.margin} at ${complete.marginPct}%. Add four hours from before any rate and the WHOLE total goes absent rather than smaller: ${holed.unratedHours}h of ${holed.hours}h unrated, cost ${JSON.stringify(holed.cost)}. A partial sum presented as a total is the failure this refuses — it looks like an answer and is short by an unknown amount. Mixed currencies are absent for the same reason. Overlapping periods are refused by lib/versioning's own check rather than a second implementation of the boundary rule.`,
      stops: 'at the timesheet — nothing feeds worked hours into this yet, and no screen records a rate. Cost is computable and not yet computed.',
      severity: '—',
      impact:
        'This is the number the whole commercial half of the product was missing. It is deliberately absent rather than approximate whenever any hour in the set is unpriced, because a margin that is quietly short is worse than one that is missing.',
    }
  },
)

scenario(
  'CR1',
  'A change is agreed, and what was originally signed is still answerable',
  'An approved change moves the contracted position without touching the baseline, and a pending one is reported separately rather than added in.',
  () => {
    const sow = { id: 'sow-1', effortHours: 400, value: 100000, currency: 'GBP' }
    const cr = (id: string, status: ChangeStatus, hours: number, value: number, extra: Partial<ChangeRequest> = {}): ChangeRequest => ({
      id, sowId: 'sow-1', issueId: null, reference: '', title: `Change ${id}`, status,
      effortHours: hours, value, currency: 'GBP', scope: 'More of it', reason: 'The client asked',
      effectiveFrom: null, requestedBy: 'Priya', requestedAt: NOW,
      decidedBy: null, decidedAt: null, decisionNote: null, deletedAt: null, ...extra,
    })

    const changes = [
      cr('cr-1', 'Approved', 80, 20000, { decidedBy: 'Nishant', decidedAt: NOW }),
      cr('cr-2', 'Approved', -20, -5000, { decidedBy: 'Nishant', decidedAt: NOW }),   // a descoping
      cr('cr-3', 'Submitted', 200, 60000),                                            // not decided
      cr('cr-4', 'Rejected', 500, 250000, { decidedBy: 'Nishant', decidedAt: NOW }),  // refused
      cr('cr-5', 'Draft', 999, 999999),                                               // never asked
      cr('cr-6', 'Withdrawn', 40, 10000),
    ]

    const p = contractedPosition(sow, changes)

    /* The baseline is untouched, and that is the property the whole model exists for. */
    const baselineIntact = p.baselineHours === 400 && p.baselineValue === 100000 && sow.effortHours === 400 && sow.value === 100000

    /* A descoping is a negative movement, not an absence of one. */
    const netMovement = p.approvedHours === 60 && p.approvedValue === 15000

    /* Pending is reported and NOT added in — the most damaging thing this could get wrong. */
    const pendingSeparate = p.pendingHours === 200 && p.pendingValue === 60000 && p.contractedValue === 115000

    /* Refused, draft and withdrawn contribute nothing at all. */
    const onlyApprovedCounts = p.approvedCount === 2 && p.pendingCount === 1

    /* As at a date: a change effective in August is not in a June position. */
    const dated = [
      cr('cr-7', 'Approved', 10, 1000, { effectiveFrom: '2026-08-01', decidedBy: 'N', decidedAt: NOW }),
      cr('cr-8', 'Approved', 10, 1000, { effectiveFrom: '2026-05-01', decidedBy: 'N', decidedAt: NOW }),
    ]
    const inJune = contractedPosition(sow, dated, '2026-06-15')
    const inSeptember = contractedPosition(sow, dated, '2026-09-15')

    /* The rules around deciding. */
    const author = { name: 'Priya', mayApprove: true }
    const approver = { name: 'Nishant', mayApprove: true }
    const selfApproval = decideChangeProblem(changes[2], 'approved', undefined, author)
    const cleanApproval = decideChangeProblem(changes[2], 'approved', undefined, approver)
    const refuseNoReason = decideChangeProblem(changes[2], 'rejected', '  ', approver)
    const decideTwice = decideChangeProblem(changes[0], 'approved', undefined, approver)
    const notAnApprover = decideChangeProblem(changes[2], 'approved', undefined, { ...approver, mayApprove: false })

    /* A change that moves nothing is a clarification, not a variation. */
    const empty = checkChange({ title: 'Tidy the wording', effortHours: 0, value: 0, reason: 'Client asked' })
    const noReason = checkChange({ title: 'More work', effortHours: 10, value: 100, reason: '  ' })

    const good =
      baselineIntact &&
      netMovement &&
      pendingSeparate &&
      onlyApprovedCounts &&
      p.contractedHours === 460 &&
      inJune.approvedValue === 1000 &&
      inSeptember.approvedValue === 2000 &&
      selfApproval !== null &&
      cleanApproval === null &&
      refuseNoReason !== null &&
      decideTwice !== null &&
      notAnApprover !== null &&
      empty !== null &&
      noReason !== null &&
      /not included above/.test(describeContracted(p))

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `Signed at ${p.baselineHours}h and ${p.currency} ${p.baselineValue.toLocaleString()}, and BOTH are still exactly that after two approved changes — the movements live on the changes, never on the statement of work, so "what did we originally agree" stays answerable however many variations follow. The approved movements net to ${p.approvedHours}h and ${p.approvedValue.toLocaleString()}, a descoping counting as the negative it is, giving ${p.contractedHours}h and ${p.contractedValue.toLocaleString()} contracted today. A submitted change worth ${p.pendingValue.toLocaleString()} is reported alongside and is NOT in that figure — a client-facing total quietly including a request nobody agreed to is the most damaging thing this could do. Refused, draft and withdrawn contribute nothing. As at a date the effective date governs, not the decision date: June sees ${inJune.approvedValue} and September sees ${inSeptember.approvedValue} from the same two approved changes. The person who raised it cannot decide it even holding the grant, refusing needs a reason, and a change moving neither effort nor value is refused as a clarification rather than inflating the count of variations a client is told they asked for.`,
      stops: 'at the screen and at the SOW panel — nothing raises or decides a change request from the UI yet, and sowPosition still reads the baseline rather than the contracted position',
      severity: 'P2',
      impact:
        'Scope change is the commonest commercial event in consulting and it had nowhere to live: a work-type string on an issue, and a SOW status that said a variation happened without saying what it was worth.',
    }
  },
)

scenario(
  'AC1',
  'A permission is added to the product and somebody can actually use it',
  'Every permission the code defines is granted to at least one shipped role, so a new feature is not born unusable.',
  () => {
    /*
     * This is a check about SILENCE, and it was written after the silence cost four features.
     *
     * `DEFAULT_GRANTS` is what a new workspace starts with, and `mergeModel` merges grants per
     * role with STORED winning — deliberately, so a firm's customisation is not reverted by a
     * deployment. The consequence is that adding a permission in code does nothing for an
     * existing workspace: the key exists, the reducer checks it, no stored role holds it, and
     * every attempt is refused by a screen that renders perfectly.
     *
     * On the day this was written five permissions were in that state in production —
     * `time.submit`, `time.approve`, `rate.view`, `rate.edit`, `change.approve` — so nobody
     * could submit a timesheet, approve one, see a rate, set one, or decide a change request.
     * Four features, all working, all unusable, and nothing anywhere said so.
     *
     * This half of it is what a harness CAN check: that the shipped defaults name an owner for
     * every key. The other half — a stored model that predates a key — is a property of a live
     * database and is what `scripts/reconcile-grants.ts` reports and repairs.
     */
    const policy = defaultAccessPolicy()
    const granted = new Set(Object.values(policy.grants).flat())
    const ungranted = PERMISSION_KEYS.filter((k) => !granted.has(k))

    /* And every granted key must be a key that exists — a typo grants nothing and looks fine. */
    const known = new Set<string>(PERMISSION_KEYS)
    const unknown = [...new Set(Object.values(policy.grants).flat())].filter((k) => !known.has(k))

    /* The administrator holds everything, which is what makes the role recoverable. */
    const adminHasAll = PERMISSION_KEYS.every((k) => (policy.grants.ROLE_ADMIN ?? []).includes(k))

    const good = ungranted.length === 0 && unknown.length === 0 && adminHasAll

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `All ${PERMISSION_KEYS.length} permissions the code defines are granted to at least one shipped role${ungranted.length ? ` — except ${ungranted.join(', ')}, which nobody can use` : ''}. No grant names a key that does not exist${unknown.length ? ` — except ${unknown.join(', ')}` : ''}, which would grant nothing while reading as a control. The administrator holds every one, which is what keeps the role able to repair a configuration that has locked somebody out. What this cannot see is a LIVE workspace whose stored grants predate a key: mergeModel lets stored win, so a permission added after a firm was seeded reaches nobody until scripts/reconcile-grants.ts is run. That is a database question, not a code one, and it is reported there.`,
      stops: 'at the stored model — this proves the shipped defaults are complete, not that a running deployment has caught up with them',
      severity: '—',
      impact:
        'Four features shipped usable-looking and unusable before this existed. The failure is silent by construction: the key is checked, the screen renders, and the refusal reads like a permissions decision somebody made.',
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
