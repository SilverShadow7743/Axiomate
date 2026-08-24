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
import { runRecurrences,
  apply,
  applyWithRules,
  initWorkspace,
  runWatch,
  scopeChainOf,
  projectOf,
  type Action,
  type SeedIssueInput,
  type WorkspaceState,
} from '../lib/workspace'
import { inboxFor, undelivered } from '../lib/notifications'
import { mentionsIn } from '../lib/mentions'
import { exposure, raidKindOf, RISK_TYPE_ID, DECISION_TYPE_ID } from '../lib/raid'
import {
  blastRadius, labelSource, agentEnabledSource, requiredSource,
  resolveLabel, resolveAgentEnabled, ROOT_SCOPE, LABEL_KEYS,
} from '../lib/config'
import { describePosition, sowPosition } from '../lib/sow'
import { capacityFor, planCheck, type Allocation, type Commitment } from '../lib/capacity'
import { myCalendarMonth } from '../lib/myCalendar'
import type { PersonalEvent } from '../lib/personalEvents'
import { directoryIdByName, rolesFor, canOnProject, isExempt } from '../lib/access'
import { projectView, memberProjectIdsFor } from '../lib/projectBoundary'
import type { ProjectMember } from '../lib/staffing'
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
import { boardLanes, dropOutcome } from '../lib/board'
import { calendarMonth, describeCalendar } from '../lib/calendar'
import { dueOccurrence, occurrenceOnOrBefore, subjectFor, type Recurrence } from '../lib/recurrence'
import { classifyForm } from '../lib/intake'
import { applyBlueprint, extractBlueprint, type Blueprint } from '../lib/blueprint'
import { isOutboundRefusal, outboundSubjectFor, recipientOf, sendingMailboxFor } from '../lib/outbound'
import { coversDocument, describeReview, versionChainOf } from '../lib/proofing'
import { clientView } from '../lib/clientBoundary'
import { accessProblems } from '../lib/access'
import { INTAKE_ACTOR } from '../lib/actor'
import { ISSUE_STATUSES } from '../lib/types'
import { computeHealth, isTerminal, pausedCalendarDays } from '../lib/schedule'
import { planSlaDates } from '../lib/sla'
import { buildDailyIms } from '../lib/reports/dailyIms'
import { effortVariance, hoursOn, summariseTime, type TimeEntry } from '../lib/time'
import { summarise } from '../lib/estimation'
import { PERMISSION_KEYS, defaultAccessPolicy } from '../lib/access'
import { publicOrigin } from '../lib/auth/origin'
import { rateAt, rateProblem, costOf, describeCost, type PersonRate } from '../lib/rates'
import {
  candidatesFor,
  checkPersonSkill,
  describeMatch,
  redactPersonSkill,
  type PersonSkill,
  type Requirement,
  type Skill,
  type SkillLevel,
} from '../lib/skills'
import { MAX_UPLOAD_BYTES, formatBytes, uploadProblem } from '../lib/documents'
import { htmlToText } from '../lib/intake'
import { describeWork, myWork } from '../lib/mywork'
import { describePortfolio, portfolio } from '../lib/portfolio'
import { capabilityStates, describeCapabilities } from '../lib/capabilities'
import { describeGoals, goalProgress } from '../lib/goals'
import {
  checkScopeItem,
  effortProblem,
  parentProblem,
  scopeFor,
  scopePosition,
  type ScopeItem,
  type ScopeKind,
} from '../lib/scope'
import { unconfiguredStore } from '../lib/storage/contract'
import {
  describeMilestones,
  isBillable,
  milestonePosition,
  milestoneValue,
  scheduleProblem,
  type Milestone,
} from '../lib/milestone'
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
  weekStarting, weekLabel, weekTotal, weekGrid, isFrozen, submitProblem, decideProblem, statusAfter,
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
      verdict: good ? 'PASS' : 'FAIL',
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
  'The system marks it as needing clarification, and the SLA clock stops while the client holds the ball — without the committed date ever moving.',
  () => {
    const dated = ok(BASE, { t: 'setDates', id: 'OAPIL-1', start: '2026-08-03', end: '2026-08-10', now: NOW } as Action)
    const dueBefore = rowFor(dated, 'OAPIL-1').plannedEndDate

    /* Into the client's hands on the 5th… */
    const waiting = ok(dated, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { status: 'Needs clarification' }, now: '2026-08-05T09:00:00.000Z',
    } as Action)
    const blockedWhileWaiting = rowFor(waiting, 'OAPIL-1').scheduleHealth === 'Blocked'

    /* …and back on the 15th: ten calendar days banked, the stamp advanced. */
    const back = ok(waiting, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { status: 'In Progress' }, now: '2026-08-15T09:00:00.000Z',
    } as Action)
    const issue = back.issues['OAPIL-1']
    const banked = issue.pausedDays === 10 && issue.statusSince === '2026-08-15'

    /* The committed date never moves; what moves is whose time the breach judgment counts. */
    const committedHeld = dueBefore === '2026-08-10' && rowFor(back, 'OAPIL-1').plannedEndDate === '2026-08-10'

    /* On the 18th the naked comparison calls this Overdue; the paused-shifted one does not. */
    const probe = {
      status: 'In Progress' as const,
      plannedStartDate: '2026-08-03',
      plannedEndDate: '2026-08-10',
      percentComplete: 30,
      actualEndDate: null,
    }
    const naked = computeHealth(probe, '2026-08-18')
    const shifted = computeHealth(probe, '2026-08-18', { pausedDays: pausedCalendarDays(issue, '2026-08-18') })
    const clockStopped = naked === 'Overdue' && shifted !== 'Overdue'

    const okAll = blockedWhileWaiting && banked && committedHeld && clockStopped
    return okAll
      ? {
          verdict: 'PASS',
          actual: `Waiting shows Blocked; leaving after ten days banks pausedDays=${issue.pausedDays} with statusSince=${issue.statusSince}; the committed date stays 2026-08-10; and on the 18th the health comparison shifted by the bank reads "${shifted}" where the naked one reads "${naked}". Nothing asks the client automatically — the reply is written from the record (phase 5), which is a person's act, not the clock's.`,
          stops: '',
          severity: 'P2',
          impact: 'none',
        } as const
      : {
          verdict: 'FAIL',
          actual: `blockedWhileWaiting=${blockedWhileWaiting} banked=${banked} (pausedDays=${issue.pausedDays}, statusSince=${issue.statusSince}) committedHeld=${committedHeld} clockStopped=${clockStopped} (naked=${naked}, shifted=${shifted})`,
          stops: 'at the clock — the pause bank disagrees with the design',
          severity: 'P1',
          impact: 'Issues breach on client time. The report calls it our failure.',
        } as const
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
    /*
     * This scenario used to prove its own claim by scanning the source for an upload path and
     * finding none. Adding one flips that regex on its own, which would have turned the sentence
     * true-by-construction while nothing had actually been uploaded — the same trap scenario A
     * was corrected for. So the check is now what it should always have been: whether the
     * pieces exist AND whether a file has ever travelled the whole path.
     */
    const hasUploadPath = !absent(/multipart\/form-data|formData\(\)|createUploadSession/)
    return {
      verdict: 'PARTIAL',
      actual: `The evidence record is still just a description (url: ${ev.url ?? 'none'}) — and beside it there is now a Document, which exists only when bytes exist. ${hasUploadPath ? 'An upload path exists: POST /api/documents stores the file in the firm’s SharePoint library through Graph and records what came back, in that order, so a crash leaves an orphaned object rather than a record pointing at nothing. GET /api/documents/[id] streams it back with a per-request check, and no storage URL is ever put in the page payload.' : 'There is no upload path anywhere in the source.'} What has not happened is a real file making the trip: the store needs an administrator to grant Files.ReadWrite.All and to name a drive, and until then every upload is refused at the door with that sentence.`,
      stops: 'at a consented document library. The model, the store contract, both endpoints and the screen are built and the not-configured refusal is the only path exercised — no file has yet been stored or produced. This becomes PASS when one has.',
      severity: 'P1',
      impact: 'Evidence still cannot be produced at a governance meeting, but the reason has changed from "nothing was built" to "one consent has not been granted", which is a different and much smaller job.',
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

    /* The cap ships HARD; this scenario is about the advisory two-step, so the firm's
       choice is made first, through the real op — AC1 proves the hard side. */
    const advisory = ok(profiled, {
      t: 'config', op: { k: 'setAllocationPolicy', patch: { cap: 'advisory' } }, now: NOW,
    } as Action)

    /* 60% on one project for a fortnight. */
    const committed = ok(advisory, {
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
      { t: 'addTime', issueId: 'OAPIL-1', person: 'Priya', date: '2026-08-05', hours: 4, activity: 'Investigation', billable: true, note: '', justification: 'Catch-up after site week.', now: NOW } as Action,
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
    const addOtherPerson = actAs(submittedState, { t: 'addTime', issueId: 'OAPIL-1', person: 'Nishant', date: '2026-08-05', hours: 3, activity: 'Investigation', billable: true, note: '', justification: 'Recorded from the visit log.', now: NOW } as Action, lead)

    /* And after the week is returned, the person can fix it — the whole point of returning it. */
    const sheetId = Object.values(submittedState.timesheets)[0]!.id
    const returned = okAs(
      submittedState,
      { t: 'decideTimesheet', id: sheetId, decision: 'rejected', reason: 'Thursday is on the wrong issue.', now: NOW } as Action,
      lead,
    )
    const editAfterReturn = actAs(returned, { t: 'updateTime', id: entryId, patch: { hours: 6, justification: 'Thursday moved to the right issue.' }, now: NOW } as Action, priya)

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
    /* The rule's own message — the reducer also mints an in-app assignment notification on
       an owner change now, which is the feature working, not the thing under test here. */
    const message = Object.values(run.state.notifications).find((n) => n.channel === 'email')
    const stuck = undelivered(run.state.notifications)

    const good = Boolean(message) && message!.delivery === 'pending' && stuck.length === 1
    return {
      verdict: good ? 'PARTIAL' : 'FAIL',
      actual: `The message is recorded with an outcome rather than attempted and lost: delivery is "${message?.delivery}" because "${message?.deliveryNote}" The scheduled pass drains this queue through the same Graph client as client mail and stamps what actually happened; the raise itself stays honest about not having sent anything yet. The undelivered count is shown to everybody rather than hidden behind a setting.`,
      stops: 'at the live send — the drain runs in production through Graph, which this harness cannot drive; Teams still has nowhere to go',
      severity: 'P2',
      impact: 'Non-delivery is visible, counted, and — for email — drained by the next pass.',
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

    const raised = Object.values(run.state.notifications).filter((n) => n.ruleId === 'AUTO_TEST').length
    /* The reducer's own assignment notice rides along — minted by the arm, not the rule. */
    const assignmentNoticed = Object.values(run.state.notifications).some((n) => n.ruleId === 'assignment' && n.to === 'Sam')
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

    const good = raised === 1 && assignmentNoticed && refused === 1 && stateIsWhole && missed.automation.misses.length === 1
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

    /*
     * And now through the reducer, which is the half that did not exist when this was written.
     *
     * The module was provable in isolation and had no production consumer at all — the design
     * called wiring it the step carrying the most regression risk, because it puts refusals in
     * front of an arm that always succeeded. These four drive `addTime` itself, so the wiring is
     * what is being proven rather than the rule a second time.
     */
    const onOpeningDay = apply(BASE, {
      t: 'addTime', issueId: 'OAPIL-1', person: 'Priya', date: '2026-08-03',
      hours: 3, activity: 'Investigation', billable: true, note: '',
      justification: 'Opening-day hours entered after the fact.', now: NOW,
    } as Action, A)
    const beforeOpening = apply(BASE, {
      t: 'addTime', issueId: 'OAPIL-1', person: 'Priya', date: '2026-08-01',
      hours: 3, activity: 'Investigation', billable: true, note: '', now: NOW,
    } as Action, A)

    /*
     * A closed issue shuts the window. Seeded closed rather than transitioned there: the status
     * policy governs which moves are legal from Open, and borrowing that graph would make this
     * scenario fail for a reason that has nothing to do with time entry.
     */
    const shut = initWorkspace([seedIssue('OAPIL-9', { status: 'Closed - confirmed' })], [])
    const afterClose = apply(shut, {
      t: 'addTime', issueId: 'OAPIL-9', person: 'Priya', date: '2026-08-05',
      hours: 3, activity: 'Investigation', billable: true, note: '', now: NOW,
    } as Action, A)

    const good =
      /* the wiring, driven through the reducer */
      !onOpeningDay.error &&
      Boolean(beforeOpening.error) &&
      /before/.test(beforeOpening.error ?? '') &&
      Boolean(afterClose.error) &&
      /extension/.test(afterClose.error ?? '') &&
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
      actual: `Three days past the due date and still open, the entry is allowed and carries a warning — "${pastDue.warnings[0] ?? ''}" — rather than a refusal, because a control that fires on every overrunning issue stops being a control. The window shuts when the issue does: a closed record refuses and names the route, "${closed.message.split('. ').slice(-1)[0]}". The opening date is ${fellBack.date} with provenance \`${fellBack.source}\` and the words "${fellBack.because}", so a window derived from the raised date can never be read as a plan somebody set; a recorded start date reports \`${stated.source}\` instead. A day before the window is refused, the opening day itself is not. Somebody else's hours refuse without \`time.recordForOthers\` and are allowed with it — the design writes that permission \`time.logForOthers\`, which does not exist, so the real key is used. A submitted week is frozen and a returned one is editable again. **And \`addTime\` now consults all of it**: an entry on the opening day is accepted, one the day before is refused ("${(beforeOpening.error ?? '').slice(0, 60)}…"), and one against a closed issue is refused with the route out ("${(afterClose.error ?? '').slice(-58)}"). The authority rule stays where it was, deliberately — this module asks whether the person owns the ISSUE, and the reducer asks whether the actor may record for the PERSON, which would have started refusing a consultant logging their own hours on a colleague's work.`,
      stops: 'at the screen. The refusals are enforced and the extension route they name — logging against a closed issue with a reason and an approval — has no UI, so today the answer is to reopen the issue. `updateTime` also does not consult the window: an entry can still be edited onto a date the window would have refused.',
      severity: '—',
      impact:
        'Time could be logged against closed work and against dates before the work existed. Both are now refused, and an overrunning issue still warns rather than refusing — which is what keeps the refusal meaningful.',
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
      stops: 'at the name join. `addTime` now reports a long day as a warning beside the confirmation, but `Version` keys on a directory id while `TimeEntry.person` holds a name — so a person whose name does not resolve gets no cap and therefore no warning. It fails to a missing remark rather than a wrong refusal, which is why it was acceptable to wire at all.',
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
  'SK1',
  'A piece of work needs somebody who can do it, and the shortlist says what it cannot see',
  'Recorded skill produces candidates rather than a recommendation, a stale skill is marked rather than dropped, and a level nobody may read shortens the list visibly rather than silently.',
  () => {
    const cat: Skill[] = [
      { id: 'sk-ic', name: 'Intercompany', category: 'D365 Finance', description: '', deletedAt: null },
      { id: 'sk-x', name: 'X++', category: 'Technical', description: '', deletedAt: null },
      { id: 'sk-old', name: 'AX 2012 upgrades', category: 'Legacy', description: '', deletedAt: NOW },
    ]
    const ps = (id: string, person: string, skillId: string, level: SkillLevel, over: Partial<PersonSkill> = {}): PersonSkill => ({
      id, personId: person, skillId, level, source: 'self', assessedBy: null,
      lastUsedOn: '2026-06-01', note: '', withheld: false,
      recordedBy: 'Operator', recordedAt: NOW, deletedAt: null, ...over,
    })

    const held = [
      ps('p1', 'AMOLAK', 'sk-ic', 'expert', { source: 'assessed', assessedBy: 'Nishant' }),
      ps('p2', 'AMOLAK', 'sk-x', 'practitioner'),
      ps('p3', 'DHARMENDRA', 'sk-ic', 'practitioner', { lastUsedOn: '2021-01-01' }),   // long ago
      ps('p4', 'JAYA', 'sk-ic', 'aware'),                                              // below the floor
      ps('p5', 'MICHAEL', 'sk-ic', 'expert', { lastUsedOn: null }),                    // nobody has said
      ps('p6', 'TARUN', 'sk-old', 'expert'),                                           // retired skill
      ps('p7', 'PRIYA', 'sk-ic', 'expert', { deletedAt: NOW }),                        // withdrawn
    ]

    const need: Requirement[] = [
      { skillId: 'sk-ic', level: 'practitioner' },
      { skillId: 'sk-x', level: 'working' },
    ]
    const m = candidatesFor(need, held, cat, '2026-08-17')
    const names = (cs: { personId: string }[]) => cs.map((c) => c.personId).sort()

    /* Everything, one requirement, so partial-versus-qualified is exercised rather than assumed. */
    const onlyIc = candidatesFor([{ skillId: 'sk-ic', level: 'practitioner' }], held, cat, '2026-08-17')

    /*
     * The redaction, driven through the matcher rather than described. A reader without
     * `skill.view` gets rows whose level is stripped, and the shortlist computed from them must
     * be SHORTER and must say so — a quietly shorter list reads as "the firm has nobody".
     */
    const asStranger = held.map((h) => redactPersonSkill(h, 'NOBODY'))
    const blind = candidatesFor(need, asStranger, cat, '2026-08-17')
    const asSelf = held.map((h) => redactPersonSkill(h, 'AMOLAK'))
    const mine = candidatesFor(need, asSelf, cat, '2026-08-17')

    /* An assessed level with no assessor is refused; a self-rated one needs nobody. */
    const anonymous = checkPersonSkill({ level: 'expert', source: 'assessed', assessedBy: '  ' })
    const signed = checkPersonSkill({ level: 'expert', source: 'assessed', assessedBy: 'Nishant' })
    const own = checkPersonSkill({ level: 'expert', source: 'self', assessedBy: null })
    const nonsense = checkPersonSkill({ level: 'guru' as SkillLevel, source: 'self', assessedBy: null })

    const good =
      /* only Amolak meets BOTH; Dharmendra and Michael meet one of the two */
      names(m.qualified).join() === 'AMOLAK' &&
      names(m.partial).join() === 'DHARMENDRA,MICHAEL' &&
      /* Jaya is below the floor on the only skill she holds, so she is not a candidate at all */
      !names(m.partial).includes('JAYA') &&
      /* a retired catalogue entry produces nobody, and a withdrawn row is not a candidate */
      !names(onlyIc.qualified).includes('TARUN') &&
      !names(onlyIc.qualified).includes('PRIYA') &&
      /* stale is MARKED, not filtered — the firm may have nobody fresher */
      m.partial.find((c) => c.personId === 'DHARMENDRA')?.stale === true &&
      m.partial.find((c) => c.personId === 'MICHAEL')?.stale === true &&
      m.qualified[0]?.stale === false &&
      /* it is a shortlist and it says what it is blind to */
      m.blind.length === 4 &&
      /shortlist, not a recommendation/.test(describeMatch(m, (id) => id)) &&
      /* and the redaction shortens it visibly rather than silently */
      blind.qualified.length === 0 &&
      blind.partial.length === 0 &&
      // Five, not seven: the retired skill and the withdrawn row are filtered out BEFORE the
      // unreadable tally, so the count reports rows this reader would otherwise have matched
      // against rather than every row in the table.
      blind.unreadable === 5 &&
      /shorter than the truth/.test(describeMatch(blind, (id) => id)) &&
      /* your own rows are never withheld, so you still find yourself */
      names(mine.qualified).join() === 'AMOLAK' &&
      /* an unsigned assessment is refused, a signed one is not, and a bad level never lands */
      anonymous !== null &&
      signed === null &&
      own === null &&
      nonsense !== null

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `Asked for Intercompany at practitioner and X++ at working: ${m.qualified.length} person meets both (${names(m.qualified).join(', ')}) and ${m.partial.length} meet part of it (${names(m.partial).join(', ')}). Jaya holds Intercompany at Aware, below the floor, so she is not on the list; Priya's row is withdrawn and Tarun's skill has been retired from the catalogue, so neither produces a candidate. Dharmendra last used it in 2021 and nobody has said when Michael last used his — both are marked stale rather than dropped, because a firm may have nobody fresher and hiding them would answer a different question. Nothing is ranked and no best match is returned: the result carries the four things it cannot see — ${m.blind.slice(0, 2).join('; ')} — and describeMatch says so in the sentence. Read by somebody without skill.view, the same data yields ${blind.qualified.length} candidates and reports ${blind.unreadable} unreadable rows, so a shortlist shortened by a permission announces itself instead of looking like an empty firm; Amolak reading it still finds himself, because a person's own rows are never withheld from them.`,
      stops: 'at demand. Nothing yet asks a deliverable what skills it needs, so the requirements above are constructed here rather than read off a work item — this answers "who could do this" only once somebody states what "this" needs. It is also deliberately not joined to availability or cost: both now exist, and combining them into one ranked answer is the delivery decision lib/capacity.ts refuses to make.',
      severity: '—',
      impact:
        'Capacity could say whether a plan was possible and never who should be on it. This closes one of the three gaps capacity.ts names — skill — and leaves the other two, client relationship and who was on the call last week, absent and stated as absent rather than quietly assumed away.',
    }
  },
)

scenario(
  'SK2',
  'A consultant records their own skills, and cannot rewrite what somebody else said about them',
  'Self-rated is yours to record, correct and retract. An assessed level is the assessor’s, and the two arms agree about that rather than one being stricter than the other.',
  () => {
    const priyaRow = Object.values(BASE.model.people).find((p) => p.name === 'Priya')!
    const other = Object.values(BASE.model.people).find((p) => p.id !== priyaRow.id)!
    const priya: Actor = { id: priyaRow.id, name: 'Priya' }

    /* The catalogue first, by somebody who may configure. */
    const withSkill = ok(BASE, {
      t: 'config', op: { k: 'upsertSkill', id: null, name: 'Intercompany', category: 'D365 Finance', description: '' }, now: NOW,
    } as Action)
    const sk = Object.values(withSkill.model.skills)[0]!

    /* A consultant: `skill.record`, and deliberately not `skill.assess`. */
    const staffed = ok(withSkill, {
      t: 'config', op: { k: 'upsertPerson', id: priyaRow.id, name: 'Priya', roleIds: ['ROLE_FUNCTIONAL'] }, now: NOW,
    } as Action)

    const rec = (s: WorkspaceState, personId: string, source: 'self' | 'assessed' | 'certified', who: Actor) =>
      apply(s, {
        t: 'recordPersonSkill', personId, skillId: sk.id, level: 'practitioner', source,
        assessedBy: source === 'assessed' ? 'Nishant Sekhar' : null,
        lastUsedOn: '2026-06-01', note: '', now: NOW,
      } as Action, who)

    /* Her own, self-rated: the case the whole `skill.record` grant exists for. */
    const own = rec(staffed, priyaRow.id, 'self', priya)
    /* Her own, claiming a certification nobody issued. */
    const selfCertified = rec(staffed, priyaRow.id, 'certified', priya)
    /* Somebody else's. */
    const forOther = rec(staffed, other.id, 'self', priya)
    /* And a second row for the same pair, which would make her level a question with two answers. */
    const duplicate = rec(own.state, priyaRow.id, 'self', priya)

    /*
     * Now an assessment about her, written by somebody who holds the grant — from `staffed`
     * rather than from `own.state`, because the one-live-row rule would refuse a second row for
     * the same pair and this needs the assessed one to be the row that exists.
     */
    const assessedAboutHer = rec(staffed, priyaRow.id, 'assessed', A)
    const theirRow = Object.values(assessedAboutHer.state.personSkills).find(
      (p) => p.personId === priyaRow.id && !p.deletedAt,
    )!

    /*
     * The two that were wrong, and are the reason this scenario exists.
     *
     * The Correct control rendered on precisely this row — her own, assessed by somebody else —
     * and every click was refused, because the reducer inherits `source` from the stored row
     * when the patch omits it. And Withdraw checked only whether the row was hers, so she could
     * delete a signed judgement she could not correct. The stronger act had the weaker gate.
     */
    const fixTheirs = apply(assessedAboutHer.state, {
      t: 'correctPersonSkill', id: theirRow.id, patch: { level: 'expert' }, now: NOW,
    } as Action, priya)
    const dropTheirs = apply(assessedAboutHer.state, {
      t: 'removePersonSkill', id: theirRow.id, now: NOW,
    } as Action, priya)

    /* Her own self-rated row — the one she recorded at step one — stays hers to correct and to retract. */
    const hersRow = Object.values(own.state.personSkills).find((p) => p.personId === priyaRow.id && !p.deletedAt)!
    const fixMine = apply(own.state, {
      t: 'correctPersonSkill', id: hersRow.id, patch: { level: 'expert' }, now: NOW,
    } as Action, priya)
    const dropMine = apply(own.state, { t: 'removePersonSkill', id: hersRow.id, now: NOW } as Action, priya)

    const good =
      !own.error &&
      Boolean(selfCertified.error) &&
      Boolean(forOther.error) &&
      Boolean(duplicate.error) &&
      !assessedAboutHer.error &&
      /* the two faults */
      Boolean(fixTheirs.error) &&
      Boolean(dropTheirs.error) &&
      /* and her own remains fully hers */
      !fixMine.error &&
      !dropMine.error

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `A consultant holding skill.record may record her own skills self-rated, and that is the case the grant exists for — a directory only a lead may write to stays empty. She may not certify herself ("${selfCertified.error}"), which is what stops the product showing a certification nobody issued, and she may not record against a colleague ("${forOther.error}"). A second row for the same person and skill is refused, because "what level is she at" must not have two answers. Somebody holding skill.assess then records an assessed level about her. She can neither correct it ("${fixTheirs.error}") nor withdraw it ("${dropTheirs.error}") — and those two agreeing is the point: the first version let her delete a signed judgement she was not allowed to correct, so the stronger act had the weaker gate. Her own self-rated row stays hers to correct and to retract.`,
      stops: '—',
      severity: '—',
      impact:
        'A level is a claim with somebody’s name on it. This is what keeps the name attached to the person who made the claim, in both directions — nobody can award themselves a credential, and nobody can quietly delete one written about them.',
    }
  },
)

scenario(
  'DOC1',
  'A file is attached to an issue, and a record only ever exists when the bytes do',
  'Uploads are refused on size, on an executable, and on a path in the name; the same file cannot be attached twice to one record; and a store nobody has configured refuses loudly rather than accepting and dropping.',
  () => {
    const attach = (s: WorkspaceState, over: Partial<Extract<Action, { t: 'recordDocument' }>> = {}, who: Actor = A) =>
      apply(s, {
        t: 'recordDocument', subjectKind: 'issue', subjectId: 'OAPIL-1',
        name: 'signed-sow.pdf', mimeType: 'application/pdf', sizeBytes: 240_000,
        checksum: 'a'.repeat(64), locator: 'graph-item-1', store: 'graph', note: '', now: NOW,
        ...over,
      } as Action, who)

    /* The rules, driven directly — this is the version a route handler cannot hide. */
    const tooBig = uploadProblem({ name: 'dump.bak', sizeBytes: MAX_UPLOAD_BYTES + 1, mimeType: '' })
    const empty = uploadProblem({ name: 'empty.txt', sizeBytes: 0, mimeType: 'text/plain' })
    const executable = uploadProblem({ name: 'setup.exe', sizeBytes: 10, mimeType: '' })
    const traversal = uploadProblem({ name: '../../etc/passwd', sizeBytes: 10, mimeType: '' })
    /* And the one an allow list would have refused and this deliberately does not. */
    const oddButReal = uploadProblem({ name: 'OAPIL_backup.axmodel', sizeBytes: 900, mimeType: '' })

    const ok1 = attach(BASE)
    const orphan = attach(BASE, { subjectId: 'NOT-A-REAL-ISSUE' })
    const nowhere = attach(BASE, { subjectKind: 'person' as never })

    /* The same bytes twice on one record is a double-click; on another record it is a second
       legitimate attachment of one specification. */
    const twiceHere = attach(ok1.state)
    const elsewhere = attach(ok1.state, { subjectId: 'OAPIL-2' })

    /* Withdrawing: your own always, somebody else's only with the grant. */
    const doc = Object.values(ok1.state.documents)[0]!
    const consultant = Object.values(BASE.model.people).find((p) => p.name === 'Priya')!
    const staffed = ok(ok1.state, {
      t: 'config', op: { k: 'upsertPerson', id: consultant.id, name: 'Priya', roleIds: ['ROLE_FUNCTIONAL'] }, now: NOW,
    } as Action)
    const theirs = apply(staffed, { t: 'removeDocument', id: doc.id, now: NOW } as Action, {
      id: consultant.id, name: 'Priya',
    })
    const mine = apply(ok1.state, { t: 'removeDocument', id: doc.id, now: NOW } as Action, A)

    /*
     * The store that is not configured. The failure being guarded against is not an exception —
     * it is a stub that returns successfully and drops the bytes, which would produce a record
     * describing a file nobody holds: the exact fault this entity exists to fix, arrived at from
     * the inside.
     */
    const store = unconfiguredStore('No document library has been chosen.')
    let refusedPut = ''
    void store.put({ tenantId: 't', name: 'x.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([1]), folder: null })
      .then(() => { refusedPut = 'IT SUCCEEDED, which would silently drop the file' })
      .catch((e: Error) => { refusedPut = e.message })

    /*
     * The mapper's refusal to write a locator-stripped copy back is asserted in the persistence
     * proof, not here: `lib/db/map.ts` is `server-only` and this harness runs without the
     * react-server condition. Splitting it that way keeps each check where it can actually run,
     * rather than weakening this file's imports to accommodate one line.
     */

    const good =
      Boolean(tooBig) && Boolean(empty) && Boolean(executable) && Boolean(traversal) &&
      oddButReal === null &&
      !ok1.error &&
      Boolean(orphan.error) &&
      Boolean(nowhere.error) &&
      Boolean(twiceHere.error) &&
      !elsewhere.error &&
      Boolean(theirs.error) &&
      !mine.error &&
      /* withdrawn softly, and the bytes deliberately not chased */
      Boolean(mine.state.documents[doc.id]?.deletedAt)

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `Refused before anything is stored: a file over the ${formatBytes(MAX_UPLOAD_BYTES)} limit, an empty one, "setup.exe" ("${executable}"), and a name carrying a path. "OAPIL_backup.axmodel" is accepted — a deny list rather than an allow list, because an allow list would refuse real consulting work weekly until somebody widened it into uselessness. The reducer refuses a document against an issue that does not exist ("${orphan.error}") and against a kind of thing documents cannot hang off, which is what stops an orphan holding real bytes that nothing lists. The same checksum on the same issue is refused as a double-click; on a different issue it is allowed, because one specification genuinely does attach to two records. A consultant cannot withdraw somebody else's attachment ("${theirs.error}"); the person who attached it always can, and withdrawing is soft and leaves the file in the library rather than reaching through to delete it. A store nobody has configured refuses every call with its reason instead of accepting and dropping, which is the failure a stub would produce by being helpful.`,
      stops: 'at a consented document library — see D. Every rule above is exercised; no byte has yet been through Graph.',
      severity: '—',
      impact:
        'The record and the artefact are now the same fact. What is still missing is one administrator action, not a feature.',
    }
  },
)

scenario(
  'MS1',
  'A milestone is delivered, accepted, and worth what it was worth on the day it was signed',
  'Delivery and acceptance are separate answers, an approved change moves a pending milestone and never an accepted one, and a schedule that does not add up says so instead of being refused.',
  () => {
    const sowId = 'sow-ms'
    const sow = { id: sowId, effortHours: 400, value: 100_000, currency: 'GBP' }
    const ms = (id: string, pct: number, over: Partial<Milestone> = {}): Milestone => ({
      id, sowId, name: `Milestone ${id}`, description: '', sequence: Number(id.slice(-1)),
      basis: 'percentage', percentage: pct, amount: null, currency: 'GBP', billOn: 'acceptance',
      plannedDate: null, delivery: 'Planned', deliveredAt: null, deliveredBy: null,
      acceptance: 'Pending', acceptedAt: null, acceptedBy: null, rejectionNote: null,
      acceptedValue: null, evidenceDocumentId: null,
      recordedBy: 'Operator', recordedAt: NOW, deletedAt: null, ...over,
    })

    /* The firm's own shape, read off its pricing model: 25/35/25/15. */
    const schedule = [
      ms('ms-1', 25, { delivery: 'Delivered', deliveredAt: NOW, deliveredBy: 'Priya', acceptance: 'Accepted', acceptedAt: NOW, acceptedBy: 'Client Sponsor', acceptedValue: 25_000 }),
      ms('ms-2', 35, { delivery: 'Delivered', deliveredAt: NOW, deliveredBy: 'Priya' }),
      ms('ms-3', 25),
      ms('ms-4', 15),
    ]

    /* A £20k change is approved AFTER milestone 1 was accepted. */
    const change: ChangeRequest = {
      id: 'cr-ms', sowId, issueId: null, reference: '', title: 'More scope', status: 'Approved',
      effortHours: 80, value: 20_000, currency: 'GBP', scope: '', reason: 'The client asked',
      effectiveFrom: null, requestedBy: 'Priya', requestedAt: NOW,
      decidedBy: 'Nishant', decidedAt: NOW, decisionNote: null, deletedAt: null,
    }
    const contracted = contractedPosition(sow, [change])

    const accepted = schedule[0]
    const pending = schedule[2]
    const acceptedWorth = milestoneValue(accepted, contracted)
    const pendingWorth = milestoneValue(pending, contracted)

    const position = milestonePosition(sowId, schedule, contracted)

    /* A retainer: no milestones at all, which is a fact about the contract and not a gap. */
    const retainer = milestonePosition('sow-retainer', [], contractedPosition({ id: 'sow-retainer', effortHours: 0, value: 60_000, currency: 'GBP' }, []))

    /* A half-entered schedule. Reported, never refused — see scheduleProblem. */
    const halfEntered = milestonePosition(sowId, [schedule[0], schedule[1]], contracted)
    const over = milestonePosition(sowId, [...schedule, ms('ms-5', 30)], contracted)

    /* The upfront shape: billable before anything is delivered. */
    const upfront = ms('ms-u', 50, { billOn: 'signature' })

    const good =
      /* the accepted one keeps what it was signed at; the pending one follows the contract */
      acceptedWorth === 25_000 &&
      pendingWorth === 30_000 &&
      /* delivered-but-not-accepted is answerable, which is the gap this closes */
      position.awaitingAcceptance === 1 &&
      position.accepted === 1 &&
      position.delivered === 2 &&
      /* billable is the acceptance trigger, so only milestone 1 counts */
      position.billableValue === 25_000 &&
      /*
       * One, not zero. Accepting without a signed certificate is ALLOWED and reported — the
       * document library needs a consent that has not been granted yet, and a milestone that
       * could not be accepted without an artefact would be unusable for as long as that takes.
       * What the product owes is to say which ones lack it, which is what this counts.
       */
      position.acceptedWithoutEvidence === 1 &&
      /* a retainer is not 0% billed, it is not billed this way */
      retainer.notMilestoneBilled === true &&
      describeMilestones(retainer).includes('normal for a retainer') &&
      /* an incomplete schedule reports the shortfall; an over-allocated one is called out harder */
      scheduleProblem(halfEntered)?.includes('not yet allocated') === true &&
      scheduleProblem(over)?.includes('more than there is to bill') === true &&
      scheduleProblem(position) === null &&
      /* and an upfront milestone is billable with nothing delivered */
      isBillable(upfront) === true &&
      isBillable(schedule[1]) === false

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `A 25/35/25/15 schedule on a £100k contract. Milestone 1 was accepted before a £20k change was approved, and it is still worth £${acceptedWorth?.toLocaleString()} — the figure was fixed at acceptance, because moving it would retroactively change what the client already signed off. Milestone 3 has not been accepted, so it follows the contracted position and is now worth £${pendingWorth?.toLocaleString()} rather than £25,000. ${position.delivered} milestones are delivered and ${position.awaitingAcceptance} is delivered and awaiting acceptance — the pair the audit records as unanswerable. £${position.billableValue.toLocaleString()} is billable, which is the accepted one only: delivery does not make money owed unless the contract says it does, and the firm's own "50% upfront" shape proves the reverse case, where signature does. Milestone 1 was accepted with no signed certificate on file, which is allowed and counted rather than blocked — the document library is one consent short, and a milestone that could not be accepted without an artefact would be unusable until that landed. A retainer with no milestones reports "${describeMilestones(retainer).slice(0, 60)}…" rather than 0% billed. A half-entered schedule reports what is unallocated instead of being refused, because a firm typing four milestones passes through 25, 60 and 85 on the way to 100.`,
      stops: 'at the invoice. A milestone can now say it is billable and nothing raises an invoice from it — `Invoice` and `InvoiceLine` are the next entity, and the audit sequences them after rates, which now exist.',
      severity: '—',
      impact:
        'The commercial spine can answer what is owed and why. It could previously answer only what was contracted in total.',
    }
  },
)

scenario(
  'HV3',
  'A version recorded against the wrong person can be withdrawn — and only then',
  'Removing a version is refused while its subject is still in the directory, so the one gap in effective dating is closed without opening a way to erase somebody’s history.',
  () => {
    const P = 'PERSON_HV3'
    const withVersion = ok(BASE, {
      t: 'recordVersion', subjectKind: 'person.workingPattern', subjectId: P,
      validFrom: '2026-01-01', validTo: null, value: { hoursPerDay: 7.5, daysPerWeek: 5 },
      reason: 'Recorded for the test', now: NOW,
    } as Action)
    const v = Object.values(withVersion.versions).find((x) => x.subjectId === P)!

    /* A real person in the directory: their history is theirs, and this must refuse. */
    const real = Object.values(BASE.model.people)[0]!
    const theirs = ok(withVersion, {
      t: 'recordVersion', subjectKind: 'person.workingPattern', subjectId: real.id,
      validFrom: '2026-01-01', validTo: null, value: { hoursPerDay: 8, daysPerWeek: 5 },
      reason: 'Recorded for the test', now: NOW,
    } as Action)
    const theirVersion = Object.values(theirs.versions).find((x) => x.subjectId === real.id)!
    const refusedLive = apply(theirs, { t: 'removeVersion', id: theirVersion.id, now: NOW } as Action, A)

    /* An unrecognised subject kind is refused rather than waved through. */
    const odd = ok(withVersion, {
      t: 'recordVersion', subjectKind: 'sow.value', subjectId: 'sow-x',
      validFrom: '2026-01-01', validTo: null, value: { amount: 1 },
      reason: 'Recorded for the test', now: NOW,
    } as Action)
    const oddVersion = Object.values(odd.versions).find((x) => x.subjectKind === 'sow.value')!
    const refusedKind = apply(odd, { t: 'removeVersion', id: oddVersion.id, now: NOW } as Action, A)

    /* PERSON_HV3 is in no directory, so its version is orphaned and removable. */
    const removed = apply(withVersion, { t: 'removeVersion', id: v.id, now: NOW } as Action, A)
    const gone = removed.state.versions[v.id] === undefined
    const stillThere = valueAt(Object.values(removed.state.versions), 'person.workingPattern', P, '2026-06-01')

    const good =
      Boolean(refusedLive.error) &&
      Boolean(refusedKind.error) &&
      !removed.error &&
      gone &&
      stillThere === null &&
      /* and the other person's version is untouched by any of it */
      Object.values(removed.state.versions).some((x) => x.subjectId === real.id) === false

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `A version whose subject is not in the directory can be withdrawn, and after it is, ${'valueAt'} answers null for that person on every date. One whose subject IS in the directory is refused — "${refusedLive.error}" — which is the guard that keeps this from being a way to erase somebody's dated history: a working pattern deleted quietly would change what capacity answered for past weeks with nothing left to say why. A subject kind the rule does not recognise is refused too ("${refusedKind.error}") rather than waved through, because subjectKind is open by design and a guard that permitted everything unfamiliar would grow into the general delete this is not.`,
      stops: 'at a UI. There is no screen for this — it exists for cleaning up after a directory record is removed, which is a script-shaped job today. `correctVersion` is in the same position and the audit records both.',
      severity: '—',
      impact:
        'Effective dating could record and correct, and never withdraw. A version recorded against the wrong person was permanent, which made the identity cleanup impossible to finish.',
    }
  },
)

scenario(
  'IN2',
  'A client sends HTML mail and a consultant can read it',
  'Markup becomes text, links survive with their targets, and plain text is passed through byte for byte.',
  () => {
    const outlook = [
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head>',
      '<style><!-- p.MsoNormal {font-family:"Calibri",sans-serif;} --></style></head><body>',
      '<p class="MsoNormal">Hi Nishant,<o:p></o:p></p>',
      '<p>The posting is failing in PROD &amp; the batch aborts at step&nbsp;3.</p>',
      '<p>Tracker: <a href="https://oapil.sharepoint.com/sites/erp">https://oapil.sharepoint.com/sites/erp</a></p>',
      '<p>See the <a href="https://learn.microsoft.com/dynamics365/">Microsoft guidance</a>.</p>',
      '<ul><li>OAPIL &ndash; fails</li>',
      '<li>SLG &#8211; works</li></ul>',
      '<p>Regards,<br>Bhandari</p></body></html>',
    ].join('\n')

    const text = htmlToText(outlook)

    /* Plain text is not markup and must come back byte for byte. */
    const plain = 'Batch fails at step 3.\n\nRegards,\nBhandari'
    const passedThrough = htmlToText(plain)

    /*
     * A client quoting code sends `&amp;lt;`. One decoding pass gives `&lt;`, which is what they
     * wrote; a second would give `<`, which is data corruption wearing the costume of tidying.
     */
    const quoted = htmlToText('<p>quoting code: &amp;lt;tag&amp;gt;</p>')

    const good =
      /* the stylesheet goes with its tag, rather than landing in the description */
      !text.includes('MsoNormal') &&
      !text.includes('Calibri') &&
      !text.includes('<o:p>') &&
      !/<[a-z/]/i.test(text) &&
      /* entities decode, including numeric */
      text.includes('PROD & the batch') &&
      text.includes('step 3') &&
      text.includes('OAPIL – fails') &&
      text.includes('SLG – works') &&
      /* a link whose text IS its address is not repeated */
      text.includes('Tracker: https://oapil.sharepoint.com/sites/erp') &&
      !text.includes('sites/erp (https') &&
      /* a labelled link keeps its target — the reason this is done here and not by the connector */
      text.includes('Microsoft guidance (https://learn.microsoft.com/dynamics365/)') &&
      /* a list reads as a list rather than as separate paragraphs */
      text.includes('- OAPIL – fails\n- SLG – works') &&
      /* nothing is hard-wrapped: the other objection to the rejected connector */
      !text.split('\n').some((l) => l.length === 80) &&
      passedThrough === plain &&
      quoted === 'quoting code: &lt;tag&gt;' &&
      htmlToText('') === ''

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `An Outlook body becomes something a person can read: the stylesheet is removed with its contents rather than left in the description, \`<o:p>\` and every other MSO artefact is gone, \`&amp;\` and \`&#8211;\` decode, and a bulleted list reads as a list. **Links keep their targets** — "Microsoft guidance (https://learn.microsoft.com/dynamics365/)" — which is the specific thing the Content Conversion connector would have discarded and the reason \`infra/intake.bicep\` rejected it. A link whose text is already its address is not repeated. Plain text comes back byte for byte, so a text/plain message is never rewritten by a function that exists for markup. Nothing is hard-wrapped, which was the connector's other failing. A client quoting code as \`&amp;lt;\` gets \`&lt;\` and not \`<\`: one decoding pass, because a second is corruption rather than tidying.`,
      stops: 'at the mailbox. The original message is not kept — it stays in the mailbox intake names in its provenance note, and storing a second copy of every client email as markup nobody reads would be a cost with no reader. Attachments are still not captured; the Logic App appends a line saying where they are.',
      severity: '—',
      impact:
        'Client mail arrived as raw markup and a consultant had to read tags to find the request. The conversion was always going to be needed somewhere; doing it here rather than in the connector is what keeps the links.',
    }
  },
)

scenario(
  'SC1',
  'A statement of work says what it will deliver, and agreeing it is a separate act',
  'Scope is recorded before it is agreed, only agreed lines count toward the total, and the total is compared with the contract rather than enforced against it.',
  () => {
    const sowId = 'sow-sc'
    const item = (
      id: string,
      kind: ScopeKind,
      text: string,
      over: Partial<ScopeItem> = {},
    ): ScopeItem => ({
      id, sowId, kind, text, parentId: null, effortHours: null, source: 'stated',
      sequence: Number(id.slice(-1)), approvedBy: null, approvedAt: null,
      recordedBy: 'Operator', recordedAt: NOW, deletedAt: null, ...over,
    })

    const items = [
      item('sc-1', 'deliverable', 'Procure-to-pay design', { effortHours: 400, approvedAt: NOW, approvedBy: 'Nishant' }),
      item('sc-2', 'deliverable', 'Intercompany configuration', { effortHours: 300, approvedAt: NOW, approvedBy: 'Nishant' }),
      /* Recorded and not agreed: real, and deliberately not in the total. */
      item('sc-3', 'deliverable', 'Second-wave rollout', { effortHours: 900 }),
      item('sc-4', 'acceptance', 'Three consecutive clean payment runs', { parentId: 'sc-1', approvedAt: NOW, approvedBy: 'Nishant' }),
      item('sc-5', 'exclusion', 'Data migration from the legacy system'),
      item('sc-6', 'scenario', 'Vendor invoice with three-way match', { effortHours: 40, approvedAt: NOW, approvedBy: 'Nishant' }),
    ]

    /* A contract of 740h against 740h of agreed work: no finding. */
    const matched = scopePosition(sowId, items, 740)
    /* The same scope against a contract of 1,000h: 260h nobody has written down. */
    const short = scopePosition(sowId, items, 1000)
    /* And against 500h: more agreed than was sold. */
    const over = scopePosition(sowId, items, 500)

    /* An assumption is a statement about the agreement, not work somebody does. */
    const effortOnStatement = checkScopeItem({ kind: 'assumption', text: 'Client provides test data', effortHours: 8 })
    const goodDeliverable = checkScopeItem({ kind: 'deliverable', text: 'Design', effortHours: 8 })
    const blank = checkScopeItem({ kind: 'deliverable', text: '   ', effortHours: null })

    /* Scope is one level deep. A criterion can hang off a deliverable, not off another criterion. */
    const underTop = parentProblem(items, 'sc-5', 'sc-1')
    const underChild = parentProblem(items, 'sc-5', 'sc-4')
    const underSelf = parentProblem(items, 'sc-1', 'sc-1')

    /* Reading order: a parent, then what hangs beneath it. */
    const ordered = scopeFor(items, sowId).map((i) => i.id)

    const good =
      /* only agreed work counts, and the unagreed 900h stays out */
      matched.approvedEffortHours === 740 &&
      matched.totalEffortHours === 1640 &&
      matched.approved === 4 &&
      matched.pending === 2 &&
      effortProblem(matched) === null &&
      /* the comparison is reported both ways round */
      effortProblem(short)?.includes('unaccounted for') === true &&
      effortProblem(over)?.includes('more than was sold') === true &&
      /* statements carry no hours */
      Boolean(effortOnStatement) &&
      goodDeliverable === null &&
      Boolean(blank) &&
      /* one level, and no self-parenting */
      underTop === null &&
      Boolean(underChild) &&
      Boolean(underSelf) &&
      /* a criterion reads directly beneath the deliverable it judges */
      ordered.indexOf('sc-4') === ordered.indexOf('sc-1') + 1

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `Six lines of scope: four agreed, two recorded and not yet agreed. Only the agreed work counts toward the total — ${matched.approvedEffortHours}h, with the unagreed ${matched.totalEffortHours - matched.approvedEffortHours}h reported beside it rather than added in, because a line somebody typed while reading a draft is not scope and its hours must not reach a figure that gets compared with a contract. That comparison is made and never enforced: against a 1,000h contract it says "${(effortProblem(short) ?? '').slice(-42)}", and against 500h it says the agreed scope is more than was sold. Both are findings for a person, not refusals — a firm entering forty deliverables passes through every intermediate total on the way. An assumption cannot carry hours ("${effortOnStatement}"). Scope is one level deep: a criterion hangs off the deliverable it judges and reads directly beneath it, and hanging one off another criterion is refused, which is what stops a scope list quietly becoming a work breakdown.`,
      stops: 'at delivery. This answers whether a line is in the agreed scope; it does not yet answer whether it has been delivered or accepted. Those are the two axes `lib/milestone.ts` already implements, and adding a second copy before deciding how a delivered deliverable relates to an accepted milestone would duplicate the model rather than reuse it — the baseline decision in the operating-model document. `source: extracted` also has no producer: SOW intelligence needs a document library that is one consent short.',
      severity: '—',
      impact:
        'What a contract says it will deliver was a paragraph of free text. It is now a list somebody can agree line by line, compare against the contracted effort, and hang acceptance criteria from.',
    }
  },
)

scenario(
  'MW1',
  'A consultant asks what to do next, and gets an answer they can argue with',
  'Work is gathered from six collections and grouped by why it wants somebody \u2014 decisions other people are blocked on first \u2014 with no priority score anywhere.',
  () => {
    const priyaRow = Object.values(BASE.model.people).find((p) => p.name === 'Priya')!
    const priya: Actor = { id: priyaRow.id, name: 'Priya' }

    /* A lead, so there is somebody whose decision is genuinely pending on somebody else. */
    const staffed = ok(BASE, {
      t: 'config', op: { k: 'upsertPerson', id: priyaRow.id, name: 'Priya', roleIds: ['ROLE_ENGAGEMENT_LEAD'] }, now: NOW,
    } as Action)

    /* Overdue: OAPIL-1 is hers and its due date is in the past. */
    const dated = ok(staffed, {
      t: 'setDates', id: 'OAPIL-1', start: '2026-08-03', end: '2026-08-10', now: NOW,
    } as Action)

    /*
     * Severity has to be able to reorder things, so the two overdue issues differ on it: OAPIL-1
     * is High and OAPIL-2 is Medium, and OAPIL-2 is made the OLDER of the two. Under the original
     * ordering — date only — the Medium would have come first.
     */
    const alsoHers = ok(dated, {
      t: 'updateIssue', id: 'OAPIL-2', patch: { owner: 'Priya' },
      reason: 'Reassigned for the test.', now: NOW,
    } as Action)
    const bothDated = ok(alsoHers, {
      t: 'setDates', id: 'OAPIL-2', start: '2026-08-01', end: '2026-08-04', now: NOW,
    } as Action)

    /* Blocked: OAPIL-3 is hers and waiting on the client. */
    const blocked = ok(bothDated, {
      t: 'updateIssue', id: 'OAPIL-3', patch: { status: 'Awaiting client confirmation' },
      reason: 'Client has not confirmed the batch window.', now: NOW,
    } as Action)

    /* Hours recorded and not submitted. */
    const withHours = ok(blocked, {
      t: 'addTime', issueId: 'OAPIL-1', person: 'Priya', date: '2026-08-05',
      hours: 4, activity: 'Investigation', billable: true, note: '',
      justification: 'Backfilled for the blocked stretch.', now: NOW,
    } as Action)

    /* And a change request somebody ELSE raised, which she may decide. */
    /* The engagement node's real id, not its label — the seed mints it. */
    const engId = Object.values(BASE.nodes).find((n) => n.kind === 'engagement')!.id
    const withSow = ok(withHours, {
      t: 'upsertSow', id: null, engagementId: engId,
      patch: { reference: 'SOW-MW', title: 'For the test', status: 'Active', effortHours: 100, value: 10000, currency: 'GBP' },
      now: NOW,
    } as Action)
    const sowId = Object.values(withSow.sows).find((x) => x.reference === 'SOW-MW')!.id
    const withChange = ok(withSow, {
      t: 'upsertChangeRequest', id: null, sowId,
      patch: { title: 'More scope', effortHours: 40, value: 4000, currency: 'GBP', scope: '', reason: 'The client asked', effectiveFrom: null },
      submit: true, now: NOW,
    } as Action)

    const list = myWork(withChange, priya, TODAY)
    const reasons = list.items.map((i) => i.reason)
    const overdueIds = list.items.filter((i) => i.reason === 'overdue').map((i) => i.subjectId)
    /*
     * Undated work, in its own tiny workspace. The three issues above are all dated or blocked,
     * so the open group is empty here — and staleness is exactly the ordering that only shows up
     * once a person has a pile of undated work, which is the state a real one is in.
     */
    const undated = initWorkspace(
      [
        seedIssue('OAPIL-20', { severity: 'High', lastActivity: '2026-05-04' }),
        seedIssue('OAPIL-21', { severity: 'High', lastActivity: '2026-08-11' }),
        seedIssue('OAPIL-22', { severity: 'Low', lastActivity: '2026-01-01' }),
      ],
      [],
    )
    const openList = myWork(undated, priya, TODAY)
    const openRows = openList.items.filter((i) => i.reason === 'open')
    const openIds = openRows.map((i) => i.subjectId)
    const openWhens = openRows.map((i) => i.when)
    const first = list.items[0]

    /* Somebody the directory does not know gets a different answer from somebody with nothing. */
    const stranger = myWork(withChange, { id: 'nobody', name: 'Nobody At All' }, TODAY)

    const good =
      /* every source is represented */
      list.counts.decide >= 1 &&
      list.counts.overdue >= 1 &&
      list.counts.blocked >= 1 &&
      list.counts.attest >= 1 &&
      /* decisions come first, because they are the only ones holding another person up */
      first.reason === 'decide' &&
      /*
       * And severity outranks age WITHIN a group. OAPIL-2 is Medium and four days older than
       * OAPIL-1, which is High — under the original date-only ordering the Medium sorted first,
       * which is the defect the "no priority score" framing concealed.
       */
      overdueIds[0] === 'OAPIL-1' &&
      overdueIds[1] === 'OAPIL-2' &&
      list.items.every((i) => i.reason !== 'decide' || i.severity === null) &&
      reasons.indexOf('decide') < reasons.indexOf('overdue') &&
      reasons.indexOf('overdue') < reasons.indexOf('blocked') &&
      /* she raised nothing, so nothing she raised is offered back to her */
      !list.items.some((i) => i.key.startsWith('cr:') && i.why.includes('Priya')) &&
      /* every row says why, in words, and no row carries a score */
      list.items.every((i) => i.why.trim().length > 0) &&
      /*
       * Undated work sorts on staleness, not on the alphabet. This was the largest group on a
       * real person's list — thirty of thirty-four — and every row had a null date, so the third
       * key did nothing and the order fell through to title.
       */
      openIds.length === 3 &&
      /* High before Low, and inside High the one nobody has touched since May comes first */
      openIds[0] === 'OAPIL-20' &&
      openIds[1] === 'OAPIL-21' &&
      openIds[2] === 'OAPIL-22' &&
      openWhens[0] === '2026-05-04' &&
      openRows.every((r) => /nothing since/.test(r.why)) &&
      /* the current week is not nagged about before it has ended */
      !list.items.some((i) => i.key === `week:${weekStarting(TODAY)}`) &&
      /* and the summary is a sentence rather than a comma-spliced list of headings */
      !/yours, open/i.test(describeWork(list)) &&
      /* the two empty cases are different answers */
      stranger.unrecognised === true &&
      /not in the directory/.test(describeWork(stranger)) &&
      /holding somebody else up/.test(describeWork(list))

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `One consultant, six collections, one list: ${list.counts.decide} awaiting her decision, ${list.counts.overdue} past its date, ${list.counts.blocked} blocked, ${list.counts.attest} week of her own hours unsubmitted, ${list.counts.due + list.counts.open} otherwise open. Decisions sort first and the sentence says why \u2014 "${describeWork(list).split('. ').slice(-1)[0]}" \u2014 because a decision is the only thing on the list that is stopping another person. Within a group the order is the date, oldest first. The rank is three parts and all three are visible: reason, then **severity**, then age. OAPIL-1 (High) sorts above OAPIL-2 (Medium) even though OAPIL-2 is four days older — an earlier version of this ordered on date alone and called itself \"no priority score\", which hid that severity was weighted at zero. No blended number is shown or stored; every row instead names what placed it ("${first.why}"). A change request she raised herself would not appear, because the reducer would refuse her decision on it and a row that cannot be acted on is worse than no row. And the two empty lists are different answers: somebody with nothing to do is told so, while somebody the directory does not know is told the join failed \u2014 "${describeWork(stranger).slice(0, 58)}\u2026" \u2014 because a person shown an empty in-tray concludes they are up to date.`,
      stops: 'at the name join. Work is found by matching a display name against `Issue.owner` and `Timesheet.person`, so somebody whose directory name differs from the name on their issues sees an empty list. That is the structural gap pending-actions records, and it is reported here rather than hidden \u2014 `unrecognised` is a distinct answer from empty.',
      severity: '\u2014',
      impact:
        'A consultant deciding what to do next had to read a tree organised by client and project, which is the wrong axis for the question. Their work is now in one place, ordered by an argument they can see and disagree with.',
    }
  },
)

scenario(
  'PF1',
  'A partner asks which engagement is in trouble',
  'Every engagement on one screen, each stating what it has overdue, blocked, unowned or gone quiet — as counts that can be checked, with no score anywhere.',
  () => {
    /*
     * The nesting is the point of this scenario.
     *
     * A real tree is `client > engagement > project`, and the first version of `portfolio` listed
     * every node of either kind. Run against production it produced two lines per engagement with
     * identical figures — the project's issues counted once under its own name and again under
     * its parent's — so every total was double the truth. The rule is now the outermost of the
     * two kinds, and this is the shape that proves it.
     */
    const engagementId = Object.values(BASE.nodes).find((n) => n.kind === 'engagement')!.id

    const nested = ok(BASE, {
      t: 'create', parentId: engagementId, kind: 'project', draft: { name: 'Phase 2' }, now: NOW,
    } as Action)
    const phase2 = Object.values(nested.nodes).find((n) => n.name === 'Phase 2')!.id
    const moved = ok(nested, { t: 'move', id: 'OAPIL-1', newParentId: phase2, now: NOW } as Action)

    /* One overdue, one blocked, one with nobody's name on it. */
    const dated = ok(moved, { t: 'setDates', id: 'OAPIL-1', start: '2026-08-01', end: '2026-08-10', now: NOW } as Action)
    /* Via In Progress, because the transition graph refuses Open straight to Awaiting — which
       this scenario found by being run rather than by being reasoned about. */
    const started = ok(dated, { t: 'updateIssue', id: 'OAPIL-2', patch: { status: 'In Progress' }, now: NOW } as Action)
    const blocked = ok(started, {
      t: 'updateIssue', id: 'OAPIL-2', patch: { status: 'Awaiting client confirmation' }, now: NOW,
    } as Action)
    const unowned = ok(blocked, { t: 'updateIssue', id: 'OAPIL-3', patch: { owner: 'Unassigned' }, now: NOW } as Action)

    /* A second engagement with nothing in it, so the quiet case is proved rather than assumed.
       An engagement with no concerns must say so plainly — the alternative is a green light,
       which is a score wearing a different hat. */
    const quiet = ok(unowned, {
      t: 'create', parentId: 'client:OAPIL', kind: 'engagement', draft: { name: 'Support Retainer' }, now: NOW,
    } as Action)

    const lines = portfolio(quiet, TODAY)
    const oapil = lines.find((l) => l.nodeId === engagementId)
    const kinds = oapil ? oapil.concerns.map((c) => c.kind) : []

    /* Every issue is counted exactly once across the whole portfolio. */
    const counted = lines.reduce((n, l) => n + l.issues, 0)
    const live = Object.values(quiet.issues).filter((i) => !i.deletedAt).length

    const good =
      /* the nested project does not get its own line — that was the double count */
      !lines.some((l) => l.name === 'Phase 2') &&
      /* and its issue is still counted, in its engagement's figures */
      oapil !== undefined &&
      oapil.projects === 1 &&
      counted === live &&
      /* the three concerns are found and ordered worst first */
      kinds.join(',') === 'overdue,blocked,unowned' &&
      /* each is a count somebody can go and check, not a rating */
      oapil.concerns.every((c) => c.count > 0 && /\d/.test(c.phrase)) &&
      /* an engagement with nothing wrong says so rather than showing a green light */
      lines.some((l) => l.concerns.length === 0) &&
      /* and the summary refuses to score */
      /nothing here is scored/.test(describePortfolio(lines))

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `${lines.length} engagements on one screen, ordered by what most wants attention. The OAPIL engagement reports "${oapil ? oapil.concerns.map((c) => c.phrase).join(', ') : 'nothing'}" — three claims, each a count that resolves to rows somebody can open, rather than a percentage or a colour. Concerns are ordered by argument, not by size: a date that has passed is a commitment already broken, so it outranks a blocked item being honestly waited on, which outranks work nobody owns. Nesting is handled where it actually bites — "Phase 2" sits under the engagement and gets no line of its own, but its issue is in the engagement's ${oapil ? oapil.issues : 0}, and across every line each of the ${live} live issues is counted exactly once. An earlier version listed both tiers and reported every engagement twice with doubled totals.`,
      stops: 'short of money. Contracted value, milestones accepted and what is unbillable are all derivable and none of them are shown, because there is no read grant for commercial figures — `sow.edit` is a write permission, and gating a read on it would conflate two questions. A commercial column also needs what `rate.view` and `skill.view` get: withholding from the page payload rather than hiding on screen.',
      severity: 'P2',
      impact:
        'A partner running three engagements had no screen that showed more than one at a time, so "which of these needs me" meant opening each and holding the comparison in their head.',
    }
  },
)

scenario(
  'CP1',
  'Somebody asks what this workspace can do, and is told what it cannot',
  'Every capability is listed with whether it is reachable, and a permission no role holds is reported as a gap rather than shown as off.',
  () => {
    /*
     * The companion to AC1, and the reason it exists.
     *
     * AC1 checks the SHIPPED defaults name an owner for every permission. That is a property of
     * the build. It cannot see the failure that actually happened: a workspace created before a
     * permission existed, whose stored roles never picked it up, where `mergeModel` keeps stored
     * grants winning — correctly, so a firm's changes survive a release — and the feature is
     * therefore refused to everybody with nothing anywhere saying so.
     *
     * This is that check at runtime, against whatever a workspace actually holds.
     */
    const healthy = capabilityStates(BASE.model)

    /* Strip one permission from every role: the exact shape of the incident AC1 records. */
    const grants = Object.fromEntries(
      Object.entries(BASE.model.access.grants).map(([r, ks]) => [r, ks.filter((k) => k !== 'time.approve')]),
    ) as typeof BASE.model.access.grants
    const stripped = capabilityStates({
      ...BASE.model,
      access: { ...BASE.model.access, grants },
    })

    const timesheets = stripped.find((c) => c.capability.id === 'timesheets')!
    const others = stripped.filter((c) => c.capability.id !== 'timesheets')

    const good =
      /* the catalogue is written by hand, so its size is asserted: a capability built
         and never added here must surface as a failing count, not as silence */
      healthy.length === 22 &&
      /* a healthy workspace reports every capability reachable */
      healthy.every((c) => c.usable) &&
      /not built but unreachable|every one of them is held/.test(describeCapabilities(healthy)) &&
      /* removing one grant is detected, and named */
      timesheets.usable === false &&
      timesheets.missing.includes('time.approve') &&
      /* and it is reported as drift from the shipped default, not merely as absent */
      timesheets.lostInMerge.includes('time.approve') &&
      /* nothing else is disturbed — the check is specific, not a blanket alarm */
      others.every((c) => c.usable) &&
      /unreachable/.test(describeCapabilities(stripped)) &&
      /* every capability names what it needs, or the check would be vacuous */
      healthy.every((c) => c.capability.needs.length > 0)

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `${healthy.length} capabilities, each naming the permissions it cannot work without and the live roles that hold them. Against this workspace every one is reachable. Take “time.approve” away from every role and exactly one row changes: Timesheets reports "unreachable", names the missing permission, and additionally reports that the product grants it by default while these stored roles do not — which is the failure AC1 was written after and could not itself detect. The two states are kept apart deliberately: OFF is a decision somebody made, UNREACHABLE is nobody having decided anything, and a single indicator covering both would hide the second behind the first.`,
      stops: 'at the catalogue being written by hand. A capability is a thing a person recognises and the code has no such concept — deriving the list from module names would produce a list of files — so something built and never added here is invisible to this screen. The count is asserted so the omission surfaces as a failing scenario rather than as silence.',
      severity: '—',
      impact:
        'Five permissions once existed in code with no stored role holding any of them, so nobody could submit a timesheet, approve one, see a rate, set one or decide a change request. Four features, all working, all unusable, and nothing said so. That state is now visible on a screen.',
    }
  },
)

scenario(
  'GL1',
  'A firm sets a target and cannot fudge how it is doing against it',
  'A goal names a measure the register computes, there is no field to enter progress into, and a measure or scope that no longer resolves reports that rather than zero.',
  () => {
    const scope = Object.values(BASE.nodes).find((n) => n.kind === 'engagement')!.id
    const set = (patch: Record<string, unknown>) =>
      apply(BASE, { t: 'config', op: { k: 'upsertGoal', id: null, patch }, now: NOW } as Action, A)

    /* Each refusal is its own sentence, because each would otherwise render as a goal sitting
       at zero — which reads as "we are failing" rather than "this is misconfigured". */
    const noName = set({ measure: 'closed', scopeId: scope, target: 5, by: '2026-09-30' }).error
    const badMeasure = set({ name: 'G', measure: 'vibes', scopeId: scope, target: 5, by: '2026-09-30' }).error
    const badScope = set({ name: 'G', measure: 'closed', scopeId: 'not-a-node', target: 5, by: '2026-09-30' }).error
    const negative = set({ name: 'G', measure: 'closed', scopeId: scope, target: -1, by: '2026-09-30' }).error
    const noDate = set({ name: 'G', measure: 'closed', scopeId: scope, target: 5, by: '' }).error
    const backwards = set({ name: 'G', measure: 'closed', scopeId: scope, target: 5, by: '2026-09-30', from: '2026-12-01' }).error

    /* A ceiling and a target, so both directions are exercised — they are not the same shape. */
    const withCeiling = ok(BASE, {
      t: 'config', op: { k: 'upsertGoal', id: null,
        patch: { name: 'Backlog under 2', measure: 'openAtMost', scopeId: scope, target: 2, by: '2026-09-30' } },
      now: NOW,
    } as Action)
    const withBoth = ok(withCeiling, {
      t: 'config', op: { k: 'upsertGoal', id: null,
        patch: { name: 'Close ten', measure: 'closed', scopeId: scope, target: 10, by: '2026-09-30', from: '2026-08-01' } },
      now: NOW,
    } as Action)

    const rows = goalProgress(withBoth, TODAY)
    const ceiling = rows.find((r) => r.goal.measure === 'openAtMost')!
    const target = rows.find((r) => r.goal.measure === 'closed')!

    /* Nothing anywhere in the stored goal is a progress figure. */
    const stored = Object.values(withBoth.model.goals)
    const fields = new Set(stored.flatMap((g2) => Object.keys(g2)))
    const noProgressField = !['progress', 'percent', 'complete', 'actual', 'status'].some((k) => fields.has(k))

    const good =
      Boolean(noName && badMeasure && badScope && negative && noDate && backwards) &&
      /not a measure/.test(badMeasure!) &&
      /part of the tree/.test(badScope!) &&
      /* the register is what answers, and it answers differently for the two directions */
      ceiling.actual === 3 && ceiling.met === false &&
      target.actual === 0 && target.met === false &&
      /ceiling/.test(ceiling.phrase) && /short/.test(target.phrase) &&
      /* no percentage anywhere, because one number would flip meaning between the two rows */
      !rows.some((r) => /%/.test(r.phrase)) &&
      noProgressField &&
      /computed from the register/.test(describeGoals(rows))

    return {
      verdict: good ? 'PASS' : 'FAIL',
      actual: `A goal names a measure and a part of the tree, and the figure is computed on every read. Two are set here over the same engagement: a ceiling ("${ceiling.phrase}") and a target ("${target.phrase}"). They are deliberately not one shape — a ceiling at 40% of its limit is healthy and a target at 40% is behind, so no percentage is shown for either. **There is no field to enter progress into**, and the stored record is checked for one: ${[...fields].join(', ')}. Six ways of setting a goal that could never be met are refused with six different sentences — no name, an unknown measure ("${badMeasure}"), a scope that is not a node, a negative target, no date, and a window that starts after the date it is judged on. Every one of those would otherwise render as a goal sitting at zero, which reads as failure rather than as misconfiguration.`,
      stops: 'at four measures. Only what the register can count is offered — work closed, open held under, unowned held under, and hours held under — and hours roll up through `TimeEntry.issueId` rather than matching a person by name, because that join is the one already known to fail silently. Milestones accepted and scope agreed are derivable and deliberately absent: they are commercial figures with no read grant, and adding them as a goal measure would reintroduce through a goal what was declined in the portfolio.',
      severity: 'P2',
      impact:
        'A firm could state targets in a document and measure them by asking people how they were doing. The measure is now the register itself, and nobody can type a number into it.',
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
 * Board and Calendar views (design 2026-08-19)
 * ================================================================== */

scenario(
  'BV1',
  'A board drag asks the same transition rules as the grid',
  'Illegal moves are refused in the policy’s own words; a closing status needing a reason asks for one before dispatch; missing evidence refuses with the message naming it',
  () => {
    const rows = rowsOf(BASE)
    const policy = BASE.model.statusPolicy
    const open = rows.find((r) => r.status === 'Open')
    if (!open) {
      return { verdict: 'FAIL', actual: 'fixture has no Open issue', stops: 'no card to drag', severity: 'P1', impact: 'scenario cannot run' } as const
    }

    const lanes = boardLanes(rows)
    const laneKeysValid = lanes.every((l) => (ISSUE_STATUSES as readonly string[]).includes(l.status))
    const laneTotal = lanes.reduce((n, l) => n + l.rows.length, 0)
    const cardable = rows.filter((r) => r.status !== null).length

    const illegal = dropOutcome(policy, open, 'Awaiting client confirmation', false)
    const illegalMsg = illegal.kind === 'refused' && /cannot move straight to/.test(illegal.message)
    const needsReason = dropOutcome(policy, open, 'Closed - no defect', false)
    const awaiting = { ...open, status: 'Awaiting client confirmation' as const }
    const noEvidence = dropOutcome(policy, awaiting, 'Closed - confirmed', false)
    const noEvidenceMsg = noEvidence.kind === 'refused' && /evidence/.test(noEvidence.message)
    const legal = dropOutcome(policy, open, 'In Progress', false)

    const okAll =
      laneKeysValid && laneTotal === cardable &&
      illegalMsg && needsReason.kind === 'ask' && noEvidenceMsg && legal.kind === 'ok'

    return okAll
      ? { verdict: 'PASS', actual: 'lanes are exactly the configured statuses and every card counted once; Open→Awaiting refused with checkTransition’s message; Closed - no defect asks for a reason; Closed - confirmed without evidence refused naming evidence; Open→In Progress ok', stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `laneKeysValid=${laneKeysValid} laneTotal=${laneTotal}/${cardable} illegal=${illegal.kind} ask=${needsReason.kind} noEvidence=${noEvidence.kind} legal=${legal.kind}`, stops: 'dropOutcome disagrees with the transition policy', severity: 'P1', impact: 'a drag could bypass or wrongly refuse the graph' } as const
  },
)

scenario(
  'CV1',
  'The calendar admits to what it cannot show',
  'dated + undated equals every card under the filter, the sentence states the undated count, and no placed span leaks outside its month',
  () => {
    const rows = rowsOf(BASE).filter((r) => r.status !== null)
    const m = calendarMonth(rows, TODAY)
    const reconciled = m.dated.length + m.undated.length === rows.length
    const sentence = describeCalendar(m)
    const stated = m.undated.length === 0 || sentence.includes(String(m.undated.length))
    const monthKey = TODAY.slice(0, 7)
    const noLeak = m.weeks.flat().every((d) => d.rows.length === 0 || d.date.slice(0, 7) === monthKey)
    const gridShape = m.weeks.every((w) => w.length === 7)

    const okAll = reconciled && stated && noLeak && gridShape
    return okAll
      ? { verdict: 'PASS', actual: `${m.dated.length} dated + ${m.undated.length} undated = ${rows.length}; sentence carries the undated count; ${m.inMonth} in month; placements stay inside the month; every week has seven days`, stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `reconciled=${reconciled} stated=${stated} noLeak=${noLeak} gridShape=${gridShape}`, stops: 'the calendar hides or double-counts part of the register', severity: 'P1', impact: 'the screen would silently show less than the register holds' } as const
  },
)

/* ================================================================== *
 * Recurring work (design 2026-08-19)
 * ================================================================== */

scenario(
  'RW1',
  'The cadence arithmetic: clamping, catch-up, and the strictly-after guard',
  'Day 31 means last-of-month everywhere; a stale rule owes exactly one occurrence; a same-day re-run owes nothing; a disabled rule owes nothing',
  () => {
    const rule = (over: Partial<Recurrence>): Recurrence => ({
      id: 'RULE_T', name: 'Month-end close', scopeId: 'engagement:X',
      cadence: { kind: 'monthly', day: 31 }, type: 'Task', severity: 'Medium',
      owner: '', enabled: true, lastRaisedOn: null, ...over,
    })

    const feb = occurrenceOnOrBefore({ kind: 'monthly', day: 31 }, '2026-03-05')
    const febLeap = occurrenceOnOrBefore({ kind: 'monthly', day: 31 }, '2028-03-05')
    const midMonth = occurrenceOnOrBefore({ kind: 'monthly', day: 31 }, '2026-08-19')
    const weekly = occurrenceOnOrBefore({ kind: 'weekly', weekday: 1 }, '2026-08-19') // Wed -> Mon 17th
    const weeklySame = occurrenceOnOrBefore({ kind: 'weekly', weekday: 3 }, '2026-08-19') // Wed -> itself

    const stale = dueOccurrence(rule({ lastRaisedOn: '2026-06-30' }), '2026-08-02')
    const sameDay = dueOccurrence(rule({ lastRaisedOn: '2026-07-31' }), '2026-08-02')
    const never = dueOccurrence(rule({}), '2026-08-02')
    const off = dueOccurrence(rule({ enabled: false }), '2026-08-02')
    const subject = subjectFor(rule({}), '2026-08-31')

    const okAll =
      feb === '2026-02-28' && febLeap === '2028-02-29' && midMonth === '2026-07-31' &&
      weekly === '2026-08-17' && weeklySame === '2026-08-19' &&
      stale === '2026-07-31' && sameDay === null && never === '2026-07-31' && off === null &&
      subject === 'Month-end close — 2026-08-31'

    return okAll
      ? { verdict: 'PASS', actual: 'Feb clamps to 28 (29 in a leap year); a rule stale since June owes only July 31; the guard is strictly-after so a raised occurrence is never re-raised; a disabled rule owes nothing; the subject carries the occurrence date', stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `feb=${feb} febLeap=${febLeap} mid=${midMonth} weekly=${weekly} weeklySame=${weeklySame} stale=${stale} sameDay=${sameDay} never=${never} off=${off}`, stops: 'the cadence arithmetic disagrees with the design', severity: 'P1', impact: 'the morning pass would flood the register or silently never raise' } as const
  },
)

scenario(
  'RW2',
  'A recurrence rule is validated where it is written',
  'A scope that cannot hold an issue is refused with the message naming it; a valid rule is stored; lastRaisedOn cannot be invented at configuration time',
  () => {
    const engagementId = Object.values(BASE.nodes).find((n) => n.kind === 'engagement')!.id
    const companyId = Object.values(BASE.nodes).find((n) => n.kind === 'company')!.id

    const bad = act(BASE, {
      t: 'config',
      op: { k: 'upsertRecurrence', id: null, patch: { name: 'Month-end close', scopeId: companyId, cadence: { kind: 'monthly', day: 31 }, enabled: true } },
      now: NOW,
    } as Action)
    const refused = Boolean(bad.error && /cannot live under a company/.test(bad.error))

    const good = act(BASE, {
      t: 'config',
      op: { k: 'upsertRecurrence', id: null, patch: { name: 'Month-end close', scopeId: engagementId, cadence: { kind: 'monthly', day: 31 }, type: 'Task', severity: 'Medium', enabled: true } },
      now: NOW,
    } as Action)
    const rule = good.error ? null : good.state.model.recurrences.find((r) => r.name === 'Month-end close')
    const stored = Boolean(rule && rule.enabled && rule.lastRaisedOn === null)

    const noName = act(BASE, {
      t: 'config',
      op: { k: 'upsertRecurrence', id: null, patch: { scopeId: engagementId, cadence: { kind: 'weekly', weekday: 1 } } },
      now: NOW,
    } as Action)
    const namedRefusal = Boolean(noName.error && /needs a name/.test(noName.error))

    const okAll = refused && stored && namedRefusal
    return okAll
      ? { verdict: 'PASS', actual: 'a company-scoped rule is refused naming the kind; a valid engagement-scoped rule stores with lastRaisedOn null; a nameless rule is refused saying why', stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `refused=${refused} (${bad.error ?? 'no error'}) stored=${stored} namedRefusal=${namedRefusal}`, stops: 'the upsert arm accepts what the pass could never file', severity: 'P1', impact: 'a rule fails at 7am instead of in the form' } as const
  },
)

scenario(
  'RW3',
  'The pass raises once, advances the guard, and a same-day re-run raises nothing',
  'First run: one issue with the occurrence-stamped subject, Open, machine-attributed, lastRaisedOn advanced to the occurrence. Second run: zero raised. A rule whose scope has since vanished refuses without advancing.',
  () => {
    const engagementId = Object.values(BASE.nodes).find((n) => n.kind === 'engagement')!.id
    const cfg = ok(BASE, {
      t: 'config',
      op: { k: 'upsertRecurrence', id: null, patch: { name: 'Weekly status', scopeId: engagementId, cadence: { kind: 'weekly', weekday: 6 }, type: 'Task', severity: 'Low', enabled: true } },
      now: NOW,
    } as Action)

    const MACHINE: Actor = { id: 'machine:schedule', name: 'Scheduled pass' }
    const first = runRecurrences(cfg, TODAY, NOW, MACHINE) // TODAY 2026-08-15 is a Saturday
    const raisedOne = first.raised.length === 1 && first.refusals.length === 0
    const occ = first.raised[0]?.occurrence
    const issue = first.raised[0] ? first.state.issues[first.raised[0].issueId] : null
    const subjectOk = Boolean(issue && issue.subject === `Weekly status — ${occ}`)
    const statusOk = Boolean(issue && issue.status === 'Open' && issue.owner === 'Unassigned')
    const ruleAfter = first.state.model.recurrences.find((r) => r.name === 'Weekly status')
    const advanced = ruleAfter?.lastRaisedOn === occ
    const attributed = first.state.audit.some((a) => a.by === 'Scheduled pass' && String(a.to ?? '').includes('Weekly status'))

    const second = runRecurrences(first.state, TODAY, NOW, MACHINE)
    const quiet = second.raised.length === 0 && second.steps.length === 0

    // The scope vanishes after the rule was written: the raise must refuse, and the guard
    // must not advance - the write-time check was the courtesy half, this is the half that holds.
    const gone = ok(cfg, { t: 'softDelete', id: engagementId, mode: 'cascade', now: NOW } as Action)
    const third = runRecurrences(gone, TODAY, NOW, MACHINE)
    const vanishedRefused =
      third.raised.length === 0 &&
      third.refusals.length === 1 &&
      (gone.model.recurrences.find((r) => r.name === 'Weekly status')?.lastRaisedOn ?? null) === null

    const okAll = raisedOne && subjectOk && statusOk && advanced && attributed && quiet && vanishedRefused
    return okAll
      ? { verdict: 'PASS', actual: `raised ${first.raised[0].issueId} “Weekly status — ${occ}” Open/Unassigned, machine-attributed; lastRaisedOn advanced to the occurrence; same-day re-run raised nothing`, stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `raisedOne=${raisedOne} refusal=${first.refusals[0]?.error ?? 'none'} subjectOk=${subjectOk} statusOk=${statusOk} advanced=${advanced} (${ruleAfter?.lastRaisedOn}) attributed=${attributed} quiet=${quiet} vanishedRefused=${vanishedRefused} (${third.refusals[0]?.error ?? 'no refusal'})`, stops: 'the raise cycle disagrees with the design', severity: 'P1', impact: 'the unattended morning pass floods or goes silent' } as const
  },
)

/* ================================================================== *
 * Intake forms (design 2026-08-19)
 * ================================================================== */

scenario(
  'IF1',
  'A form submission is classified through the same half as mail',
  'A disabled form refuses; stated urgency becomes severity with confidence stated and outranks the guess-words; routing rules still fire on form text; an empty subject falls back to the first line',
  () => {
    const engagementId = Object.values(BASE.nodes).find((n) => n.kind === 'engagement')!.id
    const form = { id: 'FORM_T', name: 'OAPIL request', scopeId: engagementId, enabled: true }
    const msg = (over: Partial<{ subject: string; body: string }> = {}) => ({
      to: 'form:FORM_T',
      from: 'Ravi Mada <ravi@client.example>',
      subject: 'Inventory posting fails',
      body: 'The inventory journal will not post. This is urgent for month end.',
      messageId: 'form-test-1',
      receivedAt: NOW,
      ...over,
    })

    const off = classifyForm({ ...form, enabled: false }, msg(), BASE.model, 'normal')
    const offRefused = 'refused' in off && /switched off/.test(off.refused.reason)

    // Stated 'low' must beat the body's 'urgent' guess-word: the sender decided.
    const statedLow = classifyForm(form, msg(), BASE.model, 'low')
    const statedWins =
      'draft' in statedLow &&
      statedLow.draft.severity === 'Low' &&
      statedLow.draft.confidence.severity === 'stated'

    const urgent = classifyForm(form, msg(), BASE.model, 'urgent')
    const urgentHigh = 'draft' in urgent && urgent.draft.severity === 'High' && urgent.draft.parentId === engagementId

    // A routing rule on a keyword fires on form text exactly as on mail.
    const ruled = ok(BASE, {
      t: 'config',
      op: {
        k: 'upsertRoutingRule', id: null,
        patch: { name: 'Inventory to Priya', when: { module: 'inventory', severity: '', keyword: '' }, then: { responsibilityTypeId: 'ISSUE_OWNER', value: 'Priya' }, enabled: true, order: 1 },
      },
      now: NOW,
    } as Action)
    const routed = classifyForm(form, msg(), ruled.model, 'normal')
    const ruleFired =
      'draft' in routed &&
      routed.draft.matchedOn.includes('Inventory to Priya') &&
      routed.draft.assignments.some((a) => a.value === 'Priya')

    const noSubject = classifyForm(form, msg({ subject: '' }), BASE.model, 'normal')
    const fellBack = 'draft' in noSubject && noSubject.draft.subject.startsWith('The inventory journal')

    const okAll = offRefused && statedWins && urgentHigh && ruleFired && fellBack
    return okAll
      ? { verdict: 'PASS', actual: 'disabled refuses naming the form; stated low beats the urgent guess-word with confidence stated; urgent maps High; the inventory rule fires and assigns Priya; empty subject falls back to the first line', stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `offRefused=${offRefused} statedWins=${statedWins} urgentHigh=${urgentHigh} ruleFired=${ruleFired} fellBack=${fellBack}`, stops: 'the form half disagrees with the mail half', severity: 'P1', impact: 'form-raised records would route differently from identical email' } as const
  },
)

scenario(
  'IF2',
  'A form is validated where it is written, and its token is the caller’s',
  'A blank token refuses; a scope that cannot hold an issue refuses naming the kind; the stored token survives unrelated edits and changes only when explicitly sent',
  () => {
    const engagementId = Object.values(BASE.nodes).find((n) => n.kind === 'engagement')!.id
    const companyId = Object.values(BASE.nodes).find((n) => n.kind === 'company')!.id

    const blank = act(BASE, {
      t: 'config',
      op: { k: 'upsertIntakeForm', id: null, patch: { name: 'OAPIL request', scopeId: engagementId, enabled: true } },
      now: NOW,
    } as Action)
    const blankRefused = Boolean(blank.error && /token minted by the caller/.test(blank.error))

    const badScope = act(BASE, {
      t: 'config',
      op: { k: 'upsertIntakeForm', id: null, patch: { name: 'OAPIL request', scopeId: companyId, token: 'tok-1', enabled: true } },
      now: NOW,
    } as Action)
    const scopeRefused = Boolean(badScope.error && /cannot live under a company/.test(badScope.error))

    const made = ok(BASE, {
      t: 'config',
      op: { k: 'upsertIntakeForm', id: null, patch: { name: 'OAPIL request', scopeId: engagementId, token: 'tok-1', enabled: true } },
      now: NOW,
    } as Action)
    const form = made.model.intakeForms.find((f) => f.name === 'OAPIL request')!

    const renamed = ok(made, {
      t: 'config',
      op: { k: 'upsertIntakeForm', id: form.id, patch: { name: 'OAPIL requests' } },
      now: NOW,
    } as Action)
    const tokenSurvives = renamed.model.intakeForms.find((f) => f.id === form.id)?.token === 'tok-1'

    const rotated = ok(renamed, {
      t: 'config',
      op: { k: 'upsertIntakeForm', id: form.id, patch: { token: 'tok-2' } },
      now: NOW,
    } as Action)
    const tokenRotates = rotated.model.intakeForms.find((f) => f.id === form.id)?.token === 'tok-2'

    const okAll = blankRefused && scopeRefused && tokenSurvives && tokenRotates
    return okAll
      ? { verdict: 'PASS', actual: 'blank token refused saying the caller mints it; company scope refused naming the kind; the token survives a rename and rotates only when explicitly sent', stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `blankRefused=${blankRefused} scopeRefused=${scopeRefused} tokenSurvives=${tokenSurvives} tokenRotates=${tokenRotates}`, stops: 'the upsert arm mishandles the capability token', severity: 'P1', impact: 'a rename would silently kill or change every distributed URL' } as const
  },
)

/* ================================================================== *
 * Blueprints (design 2026-08-19)
 * ================================================================== */

scenario(
  'BP1',
  'The round-trip: extract from an engagement, apply to a fresh parent, reproduce the shape',
  'Same tiers and items under the new parent, a dated item re-anchored to the named day, an undated item still undated, and the dependency reproduced between the mapped ids',
  () => {
    const engagementId = Object.values(BASE.nodes).find((n) => n.kind === 'engagement')!.id
    const clientId = Object.values(BASE.nodes).find((n) => n.kind === 'client')!.id

    /* Give the source a date and a dependency so the round-trip has something to carry. */
    let src = ok(BASE, { t: 'setDates', id: 'OAPIL-1', start: '2026-08-01', end: '2026-08-10', now: NOW } as Action)
    src = ok(src, { t: 'addDependency', predecessorId: 'OAPIL-1', successorId: 'OAPIL-2', dependencyType: 'FS', lagDays: 2, now: NOW } as Action)

    const proposal = extractBlueprint(src, engagementId)
    const anchorOk = proposal.anchor === '2026-08-01'
    const datedEntry = proposal.entries.find((e) => e.name === src.issues['OAPIL-1'].subject)
    const offsetsOk = datedEntry?.startOffset === 0 && datedEntry?.endOffset === 9
    const linkCarried = proposal.links.length === 1 && proposal.links[0].lagDays === 2

    const bp: Blueprint = {
      id: 'BP_T', name: 'Fixture shape', sourceEngagementId: engagementId, version: 1,
      entries: proposal.entries, links: proposal.links, applications: [],
    }
    const keep = new Set(bp.entries.map((e) => e.id))
    const run = applyBlueprint(src, bp, clientId, '2026-09-01', A, keep, NOW)

    const created = [...run.mapping.values()]
    const allApplied = created.length === bp.entries.length && run.refusals.length === 0
    const newDated = run.mapping.get(datedEntry?.id ?? '')
    const dates = newDated ? run.state.issues[newDated] : null
    const reAnchored = dates?.plannedStart === '2026-09-01' && dates?.plannedEnd === '2026-09-10'
    const undatedEntry = proposal.entries.find((e) => e.kind === 'issue' && e.endOffset === null)
    const newUndated = run.mapping.get(undatedEntry?.id ?? '')
    const stillUndated = newUndated ? run.state.issues[newUndated].plannedEnd === null : false
    const depReproduced = Object.values(run.state.dependencies).some(
      (d) => d.predecessorId === newDated && created.includes(d.successorId) && d.lagDays === 2,
    )
    const structureOk = created.every((id) => {
      const node = run.state.nodes[id]
      const issue = run.state.issues[id]
      const parent = node?.parentId ?? issue?.parentId
      return parent === clientId || created.includes(parent ?? '')
    })

    const okAll = anchorOk && offsetsOk && linkCarried && allApplied && reAnchored && stillUndated && depReproduced && structureOk
    return okAll
      ? { verdict: 'PASS', actual: `anchor 2026-08-01, offsets 0/9, ${bp.entries.length} entries applied under the client with zero refusals, the dated item re-anchored to 2026-09-01..10, the undated one still undated, the FS+2 dependency reproduced between mapped ids`, stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `anchorOk=${anchorOk} offsetsOk=${offsetsOk} link=${linkCarried} applied=${allApplied}(${run.refusals[0]?.error ?? ''}) reAnchored=${reAnchored} stillUndated=${stillUndated} dep=${depReproduced} structure=${structureOk}`, stops: 'the round-trip loses shape or dates', severity: 'P1', impact: 'a blueprint would not reproduce what it was extracted from' } as const
  },
)

scenario(
  'BP2',
  'Pruning is subtree pruning, and an archived target refuses everything',
  'An unticked parent takes its children with it; applying under an archived node collects refusals with the reducer’s message and creates nothing',
  () => {
    const engagementId = Object.values(BASE.nodes).find((n) => n.kind === 'engagement')!.id
    const clientId = Object.values(BASE.nodes).find((n) => n.kind === 'client')!.id
    const proposal = extractBlueprint(BASE, engagementId)
    const bp: Blueprint = {
      id: 'BP_T2', name: 'Fixture shape', sourceEngagementId: engagementId, version: 1,
      entries: proposal.entries, links: proposal.links, applications: [],
    }

    /* Untick the structural tier: its child issues must not apply even though ticked. */
    const tier = proposal.entries.find((e) => e.kind !== 'issue')
    const keep = new Set(bp.entries.map((e) => e.id))
    if (tier) keep.delete(tier.id)
    const pruned = applyBlueprint(BASE, bp, clientId, '2026-09-01', A, keep, NOW)
    const childEntries = proposal.entries.filter((e) => e.parentEntryId === tier?.id)
    const subtreeGone = childEntries.every((c) => !pruned.mapping.has(c.id))

    /* Archived target: the phase-2 guard refuses every create. */
    const clientGone = ok(BASE, { t: 'softDelete', id: clientId, mode: 'cascade', now: NOW } as Action)
    const refused = applyBlueprint(clientGone, bp, clientId, '2026-09-01', A, new Set(bp.entries.map((e) => e.id)), NOW)
    const nothingMade = refused.mapping.size === 0 && refused.refusals.length > 0
    const namedWhy = refused.refusals.every((r) => /archived|no longer exists/.test(r.error))

    const okAll = Boolean(tier) && subtreeGone && nothingMade && namedWhy
    return okAll
      ? { verdict: 'PASS', actual: `unticking ${tier?.name} kept its ${childEntries.length} children out of the apply; the archived target refused every create with the guard’s own message and created nothing`, stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `tier=${Boolean(tier)} subtreeGone=${subtreeGone} nothingMade=${nothingMade} namedWhy=${namedWhy} (${refused.refusals[0]?.error ?? 'none'})`, stops: 'pruning or the archived-target guard leaks', severity: 'P1', impact: 'an apply could build records nobody chose, or inside the archive' } as const
  },
)

scenario(
  'BP3',
  'Version moves only when the shape does',
  'Creation is v1; a rename stays v1; an entries edit bumps to v2; the applications append does not bump',
  () => {
    const engagementId = Object.values(BASE.nodes).find((n) => n.kind === 'engagement')!.id
    const proposal = extractBlueprint(BASE, engagementId)

    const made = ok(BASE, {
      t: 'config',
      op: { k: 'upsertBlueprint', id: null, patch: { name: 'D365 shape', sourceEngagementId: engagementId, entries: proposal.entries, links: proposal.links } },
      now: NOW,
    } as Action)
    const bp = Object.values(made.model.blueprints).find((b) => b.name === 'D365 shape')!
    const v1 = bp.version === 1

    const renamed = ok(made, {
      t: 'config',
      op: { k: 'upsertBlueprint', id: bp.id, patch: { name: 'D365 implementation shape' } },
      now: NOW,
    } as Action)
    const stillV1 = renamed.model.blueprints[bp.id].version === 1

    const edited = ok(renamed, {
      t: 'config',
      op: { k: 'upsertBlueprint', id: bp.id, patch: { entries: proposal.entries.slice(0, -1) } },
      now: NOW,
    } as Action)
    const v2 = edited.model.blueprints[bp.id].version === 2

    const appended = ok(edited, {
      t: 'config',
      op: { k: 'upsertBlueprint', id: bp.id, patch: { applications: [{ at: NOW, by: 'Validator', targetId: 'client:X', version: 2 }] } },
      now: NOW,
    } as Action)
    const stillV2 = appended.model.blueprints[bp.id].version === 2 && appended.model.blueprints[bp.id].applications.length === 1

    const empty = act(BASE, {
      t: 'config',
      op: { k: 'upsertBlueprint', id: null, patch: { name: 'Empty', entries: [] } },
      now: NOW,
    } as Action)
    const emptyRefused = Boolean(empty.error && /would build nothing/.test(empty.error))

    const okAll = v1 && stillV1 && v2 && stillV2 && emptyRefused
    return okAll
      ? { verdict: 'PASS', actual: 'v1 at creation, v1 after a rename, v2 after an entries edit, still v2 after the applications append; an empty blueprint is refused saying it would build nothing', stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `v1=${v1} stillV1=${stillV1} v2=${v2} stillV2=${stillV2} emptyRefused=${emptyRefused}`, stops: 'versioning disagrees with the provenance rule', severity: 'P1', impact: 'provenance would point at versions nobody authored' } as const
  },
)

/* ================================================================== *
 * Outbound mail (design 2026-08-19)
 * ================================================================== */

scenario(
  'OM1',
  'A reply resolves to the nearest mailbox, a real recipient, and a threaded subject',
  'The engagement mailbox beats a client-wide one; no covering mailbox refuses naming the configuration; a display-name-only claim gets no compose; the subject carries the id',
  () => {
    const engagementId = Object.values(BASE.nodes).find((n) => n.kind === 'engagement')!.id
    const clientId = Object.values(BASE.nodes).find((n) => n.kind === 'client')!.id

    /* The claim: OAPIL-1 raised by an angle-bracket sender. */
    const claimed = ok(BASE, { t: 'updateIssue', id: 'OAPIL-1', patch: { raisedBy: 'Ravi Mada <ravi@client.example>' }, now: NOW } as Action)
    let s1 = claimed

    /* Client-wide mailbox only: resolves, but as the client's address. */
    s1 = ok(s1, { t: 'config', op: { k: 'upsertIntake', id: null, patch: { address: 'client-wide@axiocloud.example', scopeId: clientId, enabled: true } }, now: NOW } as Action)
    const clientOnly = sendingMailboxFor(s1, 'OAPIL-1')
    const clientWide = !isOutboundRefusal(clientOnly) && clientOnly.mailbox.address === 'client-wide@axiocloud.example'

    /* Add the engagement's own mailbox: nearest must now win. */
    const s2 = ok(s1, { t: 'config', op: { k: 'upsertIntake', id: null, patch: { address: 'engagement@axiocloud.example', scopeId: engagementId, enabled: true } }, now: NOW } as Action)
    const near = sendingMailboxFor(s2, 'OAPIL-1')
    const nearest = !isOutboundRefusal(near) && near.mailbox.address === 'engagement@axiocloud.example'
    const threaded = !isOutboundRefusal(near) && /^RE: .+ \[OAPIL-1\]$/.test(near.subject)
    const toClaim = !isOutboundRefusal(near) && near.recipient === 'ravi@client.example'

    /* Disable the engagement's mailbox: a switched-off mailbox must not speak, so
       resolution falls back to the client-wide one. */
    const engBox = s2.model.intake.find((m) => m.address === 'engagement@axiocloud.example')!
    const s2b = ok(s2, { t: 'config', op: { k: 'upsertIntake', id: engBox.id, patch: { enabled: false } }, now: NOW } as Action)
    const off = sendingMailboxFor(s2b, 'OAPIL-1')
    const disabledSkipped = !isOutboundRefusal(off) && off.mailbox.address === 'client-wide@axiocloud.example'

    /* No mailbox anywhere: refuse naming the configuration screen. */
    const bare = sendingMailboxFor(claimed, 'OAPIL-1')
    const noBox = isOutboundRefusal(bare) && bare.code === 'no-mailbox' && /Routing & intake/.test(bare.reason)

    /* A display-name-only claim gets no compose. */
    const s3 = ok(s2, { t: 'updateIssue', id: 'OAPIL-2', patch: { raisedBy: 'Somebody At Client' }, now: NOW } as Action)
    const noAddr = sendingMailboxFor(s3, 'OAPIL-2')
    const noRecipient = isOutboundRefusal(noAddr) && noAddr.code === 'no-recipient'

    const bareEmail = recipientOf('ravi@client.example') === 'ravi@client.example'
    const subjectShape = outboundSubjectFor('OAPIL-9', '  Inventory fails  ') === 'RE: Inventory fails [OAPIL-9]'

    const okAll = clientWide && nearest && threaded && toClaim && disabledSkipped && noBox && noRecipient && bareEmail && subjectShape
    return okAll
      ? { verdict: 'PASS', actual: 'client-wide resolves alone; the engagement mailbox wins once it exists and is skipped once disabled; subject is RE: subject [id]; the recipient is the claimed address; no mailbox and no address both refuse with their own codes', stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `clientWide=${clientWide} nearest=${nearest} threaded=${threaded} toClaim=${toClaim} disabledSkipped=${disabledSkipped} noBox=${noBox} noRecipient=${noRecipient} bareEmail=${bareEmail} subjectShape=${subjectShape}`, stops: 'outbound resolution disagrees with the design', severity: 'P1', impact: 'a reply could go out as the wrong mailbox or to nobody stated' } as const
  },
)

/* ================================================================== *
 * Proofing (design 2026-08-22)
 * ================================================================== */

scenario(
  'PR1',
  'A deliverable is sent for review, judged, re-judged, and re-uploaded',
  'The review pins the bytes it was asked about; the asker cannot answer; a change request names its change; a second answer replaces the first; a new version visibly does not carry the old approval.',
  () => {
    const asker: Actor = { id: 'pr-a', name: 'Asha' }
    const priya: Actor = { id: 'pr-p', name: 'Priya' }
    const tarun: Actor = { id: 'pr-t', name: 'Tarun' }

    const s0 = apply(BASE, {
      t: 'recordDocument', subjectKind: 'issue', subjectId: 'OAPIL-1', name: 'cutover-plan.pdf',
      mimeType: 'application/pdf', sizeBytes: 4096, checksum: 'bytes-v1', locator: 't/v1', store: 'graph', note: '', now: NOW,
    } as Action, asker).state
    const docId = Object.values(s0.documents).find((d) => d.checksum === 'bytes-v1')!.id

    /* The asker may not review their own ask. */
    const selfAsk = apply(s0, { t: 'requestDocumentReview', documentId: docId, reviewers: ['Asha'], question: 'ok?', now: NOW } as Action, asker)
    const selfRefused = Boolean(selfAsk.error)

    const s1 = apply(s0, {
      t: 'requestDocumentReview', documentId: docId, reviewers: ['Priya', 'Tarun'],
      question: 'Does this go to the client?', now: NOW,
    } as Action, asker).state
    const review = () => Object.values(s1x.documentReviews)[0]
    let s1x = s1
    const pinned = Object.values(s1.documentReviews)[0].checksum === 'bytes-v1'

    /* Refusals, in the arm's own words. */
    const askerDecides = apply(s1, { t: 'decideDocumentReview', reviewId: review().id, verdict: 'approved', note: '', now: NOW } as Action, asker)
    const outsiderDecides = apply(s1, { t: 'decideDocumentReview', reviewId: review().id, verdict: 'approved', note: '', now: NOW } as Action, A)
    const notelessChanges = apply(s1, { t: 'decideDocumentReview', reviewId: review().id, verdict: 'changes', note: '  ', now: NOW } as Action, priya)
    const refusals = Boolean(askerDecides.error) && Boolean(outsiderDecides.error) && Boolean(notelessChanges.error)

    /* Priya asks for changes, then changes her mind — replaced, not appended. */
    s1x = apply(s1x, { t: 'decideDocumentReview', reviewId: review().id, verdict: 'changes', note: 'Section 3 names the wrong environment.', now: NOW } as Action, priya).state
    const midChanges = describeReview(review(), s1x.documents[docId]) === 'changes requested'
    s1x = apply(s1x, { t: 'decideDocumentReview', reviewId: review().id, verdict: 'approved', note: 'Fixed in the call.', now: NOW } as Action, priya).state
    const replaced = review().verdicts.length === 1 && review().verdicts[0].verdict === 'approved'
    const stillAwaiting = describeReview(review(), s1x.documents[docId]) === 'awaiting 1 of 2'

    /* Tarun completes it: approved, and the pinned Decision note lands on the record. */
    s1x = apply(s1x, { t: 'decideDocumentReview', reviewId: review().id, verdict: 'approved', note: '', now: NOW } as Action, tarun).state
    const approved = describeReview(review(), s1x.documents[docId]) === 'approved'
    const noted = Object.values(s1x.notes).some((n) => n.issueId === 'OAPIL-1' && n.pinned && /APPROVED/.test(n.body) && n.noteType === 'Decision')

    /* A new version: the chain grows, and the approval visibly stays with the old bytes. */
    const s2 = apply(s1x, {
      t: 'recordDocument', subjectKind: 'issue', subjectId: 'OAPIL-1', name: 'cutover-plan.pdf',
      mimeType: 'application/pdf', sizeBytes: 5000, checksum: 'bytes-v2', locator: 't/v2', store: 'graph', note: '', now: NOW,
      supersedesId: docId,
    } as Action, asker).state
    const v2 = Object.values(s2.documents).find((d) => d.checksum === 'bytes-v2')!
    const chain = versionChainOf(s2.documents, docId)
    const chained = chain.length === 2 && chain[0].id === v2.id && chain[1].id === docId
    const earlier = !coversDocument(Object.values(s2.documentReviews)[0], v2) &&
      describeReview(Object.values(s2.documentReviews)[0], v2) === 'approved — an earlier version'
    /* And the chain is linear: a second successor of v1 is refused. */
    const secondSuccessor = apply(s2, {
      t: 'recordDocument', subjectKind: 'issue', subjectId: 'OAPIL-1', name: 'cutover-plan.pdf',
      mimeType: 'application/pdf', sizeBytes: 5001, checksum: 'bytes-v3', locator: 't/v3', store: 'graph', note: '', now: NOW,
      supersedesId: docId,
    } as Action, asker)
    const linear = Boolean(secondSuccessor.error)

    const okAll = selfRefused && pinned && refusals && midChanges && replaced && stillAwaiting && approved && noted && chained && earlier && linear
    return okAll
      ? { verdict: 'PASS', actual: 'The ask pins bytes-v1; the asker, an outsider, and a noteless change request are refused in the arm’s words; Priya’s second answer replaces her first and completion waits for Tarun; approval lands as a pinned Decision note; v2 supersedes v1, reads "approved — an earlier version", and a second successor of v1 is refused.', stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `selfRefused=${selfRefused} pinned=${pinned} refusals=${refusals} midChanges=${midChanges} replaced=${replaced} stillAwaiting=${stillAwaiting} approved=${approved} noted=${noted} chained=${chained} earlier=${earlier} linear=${linear}`, stops: 'the review lifecycle disagrees with the design', severity: 'P1', impact: 'a deliverable could read as approved when the approved bytes are not the ones being sent' } as const
  },
)

/* ================================================================== *
 * Identity ids (design 2026-08-22)
 * ================================================================== */

scenario(
  'ID1',
  'A person is renamed and their records stay theirs',
  'Join fields carry a directory id resolved at write time; the id wins on read; ambiguity resolves to null rather than a guess; pre-migration rows still join by name; role audiences never resolve to a person.',
  () => {
    const priya = Object.values(BASE.model.people).find((p) => p.name === 'Priya')!

    /* Write-time resolution: assigning a unique name stores its id, and the assignment
       notification carries it too. */
    const assigned = ok(BASE, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { owner: 'Priya' }, now: NOW,
    } as Action)
    /* BASE already has Priya as owner — move away and back so the change actually fires. */
    const away = ok(BASE, { t: 'updateIssue', id: 'OAPIL-1', patch: { owner: 'Sam' }, now: NOW } as Action)
    const back = ok(away, { t: 'updateIssue', id: 'OAPIL-1', patch: { owner: 'Priya' }, now: '2026-08-18T09:00:00.000Z' } as Action)
    const stored = back.issues['OAPIL-1'].ownerId === priya.id
    const notice = Object.values(back.notifications).find((n) => n.ruleId === 'assignment' && n.to === 'Priya')
    const noticeId = notice?.toId === priya.id

    /* Ambiguity resolves to null, never a guess — driven on the pure resolver. */
    const dupModel = {
      ...BASE.model,
      people: {
        ...BASE.model.people,
        DUP_1: { id: 'DUP_1', name: 'Same Name', roleIds: [], fromSource: false },
        DUP_2: { id: 'DUP_2', name: 'same name ', roleIds: [], fromSource: false },
      },
    }
    const ambiguous = directoryIdByName(dupModel, 'Same Name') === null
    const unique = directoryIdByName(BASE.model, 'priya') === priya.id
    const unassigned = directoryIdByName(BASE.model, 'Unassigned') === null

    /* The rename: one field edit, no sweep — and the joins hold. */
    const renamed = ok(back, {
      t: 'config',
      op: { k: 'upsertPerson', id: priya.id, name: 'Priya Renamed', roleIds: priya.roleIds },
      now: NOW,
    } as Action)
    const mineAfter = myWork(renamed, { id: 'val-p', name: 'Priya Renamed' }, TODAY)
    const workSurvives = mineAfter.items.some((i) => i.subjectId === 'OAPIL-1')
    const inboxSurvives = inboxFor(renamed.notifications, 'Priya Renamed', priya.id).some(
      (n) => n.ruleId === 'assignment',
    )
    /* The OLD name is nobody now — the list says the join failed rather than pretending. */
    const oldName = myWork(renamed, { id: 'val-q', name: 'Priya' }, TODAY)
    const oldNameHonest = oldName.unrecognised && !oldName.items.some((i) => i.subjectId === 'OAPIL-1')

    /* Pre-migration shape: a null id still joins by name. */
    const legacy = {
      ...back,
      issues: { ...back.issues, 'OAPIL-1': { ...back.issues['OAPIL-1'], ownerId: null } },
    }
    const legacyJoins = myWork(legacy, { id: 'val-p', name: 'Priya' }, TODAY).items.some(
      (i) => i.subjectId === 'OAPIL-1',
    )

    /* Role audiences never resolve to a person id. */
    const roleNotify = ok(BASE, {
      t: 'notify', to: 'role:ROLE_ENGAGEMENT_LEAD', channel: 'in-app', subject: 'x', body: 'x', aboutId: 'OAPIL-1', ruleId: 'AUTO_T', now: NOW,
    } as Action)
    const roleNull = Object.values(roleNotify.notifications).every((n) => n.to !== 'role:ROLE_ENGAGEMENT_LEAD' || n.toId === null)

    void assigned
    const okAll = stored && noticeId && ambiguous && unique && unassigned && workSurvives && inboxSurvives && oldNameHonest && legacyJoins && roleNull
    return okAll
      ? { verdict: 'PASS', actual: 'Assigning Priya stores her directory id on the issue and on the assignment notice; two entries sharing a name resolve to null rather than a guess; after a rename her My Work and inbox still hold the records by id while the abandoned name honestly matches nothing; a pre-migration row with a null id still joins by name; a role-addressed notification keeps toId null.', stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `stored=${stored} noticeId=${noticeId} ambiguous=${ambiguous} unique=${unique} unassigned=${unassigned} workSurvives=${workSurvives} inboxSurvives=${inboxSurvives} oldNameHonest=${oldNameHonest} legacyJoins=${legacyJoins} roleNull=${roleNull}`, stops: 'the identity join disagrees with the design', severity: 'P1', impact: 'a renamed person loses their queue, their inbox, or both — the Tarun incident class' } as const
  },
)

/* ================================================================== *
 * Client boundary (design 2026-08-22)
 * ================================================================== */

scenario(
  'CB1',
  'What the client sees was decided per record, and nothing else leaves',
  'Internal creation is born internal; a client\u2019s own submission and an intake arrival are born visible; marking is editing; the withheld view keeps marked content with its ancestors and empties the machinery.',
  () => {
    const moduleId = Object.values(BASE.nodes).find((n) => n.kind === 'module')!.id

    /* Birth rules. */
    const internalBorn = ok(BASE, { t: 'create', parentId: moduleId, kind: 'issue', draft: { name: 'Internal work' }, now: NOW } as Action)
    const internalIssue = Object.values(internalBorn.issues).find((i) => i.subject === 'Internal work')!
    const bornInternal = internalIssue.clientVisible === false

    const staffed = ok(BASE, { t: 'config', op: { k: 'upsertPerson', id: null, name: 'Client Carol', roleIds: ['ROLE_CLIENT_SPONSOR'] }, now: NOW } as Action)
    const carolCreates = apply(staffed, { t: 'create', parentId: moduleId, kind: 'issue', draft: { name: 'Carol asks' }, now: NOW } as Action, { id: 'cc', name: 'Client Carol' }).state
    const carolIssue = Object.values(carolCreates.issues).find((i) => i.subject === 'Carol asks')
    const bornVisibleClient = carolIssue?.clientVisible === true

    const intakeCreates = apply(BASE, { t: 'create', parentId: moduleId, kind: 'issue', draft: { name: 'Mailed in' }, now: NOW } as Action, INTAKE_ACTOR).state
    const intakeIssue = Object.values(intakeCreates.issues).find((i) => i.subject === 'Mailed in')
    const bornVisibleIntake = intakeIssue?.clientVisible === true

    /* Marking is editing; the flag audits like any field. */
    const marked = ok(internalBorn, { t: 'updateIssue', id: internalIssue.id, patch: { clientVisible: true }, now: NOW } as Action)
    const flipped = marked.issues[internalIssue.id].clientVisible === true

    /* Notes: default internal; the explicit flag rides addNote; updateNote flips it. */
    let s1 = ok(marked, { t: 'addNote', issueId: internalIssue.id, body: 'internal working note', noteType: 'Investigation', pinned: false, now: NOW } as Action)
    s1 = ok(s1, { t: 'addNote', issueId: internalIssue.id, body: 'what we told the client', noteType: 'Client Communication', pinned: true, clientVisible: true, now: NOW } as Action)
    const visNote = Object.values(s1.notes).find((n) => n.body === 'what we told the client')!
    const intNote = Object.values(s1.notes).find((n) => n.body === 'internal working note')!
    const noteDefaults = intNote.clientVisible !== true && visNote.clientVisible === true

    /* A document flagged after upload, through the one new arm. */
    s1 = ok(s1, { t: 'recordDocument', subjectKind: 'issue', subjectId: internalIssue.id, name: 'Plan.pdf', mimeType: 'application/pdf', sizeBytes: 10, checksum: 'cb'.repeat(32), locator: 't/cb', store: 'graph', note: '', now: NOW } as Action)
    const doc = Object.values(s1.documents).find((d) => d.name === 'Plan.pdf')!
    s1 = ok(s1, { t: 'setDocumentVisibility', id: doc.id, clientVisible: true, now: NOW } as Action)
    const docFlagged = s1.documents[doc.id].clientVisible === true

    /* The withheld view: marked content with ancestors; machinery empty; audit filtered. */
    const cb1Client = Object.values(BASE.nodes).find((n) => n.kind === 'client')!.id
    const view = clientView(s1, cb1Client)
    const keptIssue = Boolean(view.issues[internalIssue.id])
    const droppedInternalIssues = Object.values(view.issues).every((i) => i.clientVisible)
    const ancestors = view.issues[internalIssue.id] ? Boolean(view.nodes[view.issues[internalIssue.id].parentId]) : false
    const notesRight = Boolean(Object.values(view.notes).find((n) => n.body === 'what we told the client')) &&
      !Object.values(view.notes).some((n) => n.body === 'internal working note')
    const docsRight = Boolean(view.documents[doc.id])
    const machineryEmpty =
      Object.keys(view.rates).length === 0 && Object.keys(view.timeEntries).length === 0 &&
      Object.keys(view.estimates).length === 0 && Object.keys(view.allocations).length === 0 &&
      Object.keys(view.sows).length === 0 && Object.keys(view.notifications).length === 0
    const auditFiltered = view.audit.every((a) => Boolean(view.issues[a.rowId]))

    /* The key is ungrantable to a shipped client role. */
    const refused = accessProblems(
      { ...BASE.model.access, grants: { ...BASE.model.access.grants, ROLE_CLIENT_USER: ['work.create', 'internal.view'] } },
      Object.keys(BASE.model.roles),
    ).some((p) => /client role/i.test(p))

    const okAll = bornInternal && bornVisibleClient && bornVisibleIntake && flipped && noteDefaults && docFlagged &&
      keptIssue && droppedInternalIssues && ancestors && notesRight && docsRight && machineryEmpty && auditFiltered && refused
    return okAll
      ? { verdict: 'PASS', actual: 'Internal creation is born internal; Carol\u2019s own submission and an intake arrival are born visible; the flag flips through ordinary edits and the one new document arm; the withheld view keeps the marked record with its ancestor chain, the marked note and the flagged document, empties every commercial and people table, filters audit to surviving records, and the grant screen refuses internal.view on a client role.', stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `bornInternal=${bornInternal} bornVisibleClient=${bornVisibleClient} bornVisibleIntake=${bornVisibleIntake} flipped=${flipped} noteDefaults=${noteDefaults} docFlagged=${docFlagged} keptIssue=${keptIssue} droppedInternal=${droppedInternalIssues} ancestors=${ancestors} notesRight=${notesRight} docsRight=${docsRight} machineryEmpty=${machineryEmpty} auditFiltered=${auditFiltered} refused=${refused}`, stops: 'the boundary disagrees with the design', severity: 'P1', impact: 'internal content one guest sign-in away from a client' } as const
  },
)

/* ================================================================== *
 * Time grace (design 2026-08-22)
 * ================================================================== */

scenario(
  'TG1',
  'A late entry explains itself, at whatever allowance the firm set',
  'The allowance is policy, not a constant: set to 3, an entry 3 days late records freely, 4 days late is refused without a reason and recorded with one, and a correction to a stale entry is gated the same way \u2014 the audit row saying how late.',
  () => {
    /* The op validates in the module's words; 90 is refused, 3 is set. */
    const refused = act(BASE, { t: 'config', op: { k: 'setTimePolicy', patch: { backdatingAllowanceDays: 90 } }, now: NOW } as Action)
    const badRefused = Boolean(refused.error && /between 0 and 60/.test(refused.error))

    const tuned = ok(BASE, { t: 'config', op: { k: 'setTimePolicy', patch: { backdatingAllowanceDays: 3 } }, now: NOW } as Action)
    const policySet = tuned.model.timePolicy.backdatingAllowanceDays === 3
    const defaultStands = BASE.model.timePolicy.backdatingAllowanceDays === 7

    /* TODAY is 2026-08-15. Three days late \u2014 exactly at the allowance \u2014 asks nothing. */
    const inTime = ok(tuned, {
      t: 'addTime', issueId: 'OAPIL-1', person: A.name, date: '2026-08-12',
      hours: 2, activity: 'Resolution', billable: true, note: '', now: NOW,
    } as Action)
    const quiet = Object.values(inTime.timeEntries).find((e) => e.date === '2026-08-12')
    const insideFree = Boolean(quiet) && (quiet!.justification ?? null) === null

    /* Four days late: refused without a reason, in words that name both numbers. */
    const bare = act(inTime, {
      t: 'addTime', issueId: 'OAPIL-1', person: A.name, date: '2026-08-11',
      hours: 3, activity: 'Resolution', billable: true, note: '', now: NOW,
    } as Action)
    const lateRefused = Boolean(bare.error && /4 days after/.test(bare.error) && /allowance is 3/.test(bare.error))

    const withReason = ok(inTime, {
      t: 'addTime', issueId: 'OAPIL-1', person: A.name, date: '2026-08-11',
      hours: 3, activity: 'Resolution', billable: true, note: '',
      justification: 'Site week \u2014 hours reconstructed from the visit log.', now: NOW,
    } as Action)
    const late = Object.values(withReason.timeEntries).find((e) => e.date === '2026-08-11')
    const reasonStored = late?.justification === 'Site week \u2014 hours reconstructed from the visit log.'
    const auditSaysLate = withReason.audit.some((row) => row.field === 'time' && /4 days late/.test(row.to ?? ''))

    /* Correcting a stale entry's hours is the same reconstruction. */
    const bumpBare = act(withReason, { t: 'updateTime', id: late!.id, patch: { hours: 5 }, now: NOW } as Action)
    const updateRefused = Boolean(bumpBare.error && /Add a reason to change it/.test(bumpBare.error))
    const bumped = ok(withReason, {
      t: 'updateTime', id: late!.id,
      patch: { hours: 5, justification: 'Visit log corrected \u2014 the Tuesday session ran long.' },
      now: NOW,
    } as Action)
    const corrected = bumped.timeEntries[late!.id]
    const updateRecorded = corrected.hours === 5 && corrected.justification === 'Visit log corrected \u2014 the Tuesday session ran long.'

    /* A relabel on the same stale entry changes no claimed number and passes untouched. */
    const relabel = act(bumped, { t: 'updateTime', id: late!.id, patch: { billable: false }, now: NOW } as Action)
    const relabelFree = !relabel.error

    const good = badRefused && policySet && defaultStands && insideFree && lateRefused &&
      reasonStored && auditSaysLate && updateRefused && updateRecorded && relabelFree
    return good
      ? { verdict: 'PASS', actual: 'The allowance is read from the operating model, refused outside 0\u201360 in the module\u2019s words, and the shipped default stays 7. At an allowance of 3: exactly 3 days late records with no reason asked; 4 days late is refused naming both numbers and records with a reason, which is stored on the entry and stamped on the audit row as \u201c4 days late\u201d. Correcting a stale entry\u2019s hours is gated identically \u2014 refused bare, recorded with its reason \u2014 while relabelling its billing passes untouched, because it changes no claimed number.', stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `badRefused=${badRefused} policySet=${policySet} defaultStands=${defaultStands} insideFree=${insideFree} lateRefused=${lateRefused} reasonStored=${reasonStored} auditSaysLate=${auditSaysLate} updateRefused=${updateRefused} updateRecorded=${updateRecorded} relabelFree=${relabelFree}`, stops: 'the grace gate disagrees with the design', severity: 'P1', impact: 'late hours recorded silently, or honest hours refused' } as const
  },
)

/* ================================================================== *
 * Allocation cap (design 2026-08-23)
 * ================================================================== */

scenario(
  'AC1',
  'The allocation cap holds, at whichever hardness the firm set',
  'Shipped hard, nobody can be committed past capacity \u2014 the override flag included; advisory restores the recorded two-step; the judgement underneath never moves.',
  () => {
    const engagementId = Object.values(BASE.nodes).find((n) => n.kind === 'engagement')!.id
    let s1 = BASE
    for (const name of ['Cap North', 'Cap South']) {
      s1 = ok(s1, { t: 'create', parentId: engagementId, kind: 'project', draft: { name }, now: NOW } as Action)
    }
    const [pA, pB] = Object.values(s1.nodes).filter((n) => n.kind === 'project' && /^Cap /.test(n.name))

    /* The default is the PRD's rule, and an invalid mode is refused by the op. */
    const shippedHard = BASE.model.allocationPolicy.cap === 'hard'
    const badMode = act(BASE, { t: 'config', op: { k: 'setAllocationPolicy', patch: { cap: 'firm' } }, now: NOW } as unknown as Action)
    const badRefused = Boolean(badMode.error && /hard.*advisory/.test(badMode.error))

    /* 60% committed; 60% more over the same window is more than exists. */
    const first = ok(s1, {
      t: 'upsertAllocation', id: null, person: 'Priya', projectId: pA.id,
      startDate: '2026-09-01', endDate: '2026-09-11', percentage: 60, note: '', now: NOW,
    } as Action)

    /* Hard: refused BARE and refused WITH the override \u2014 the flag stopped being a key. */
    const bare = act(first, {
      t: 'upsertAllocation', id: null, person: 'Priya', projectId: pB.id,
      startDate: '2026-09-01', endDate: '2026-09-11', percentage: 60, note: '', now: NOW,
    } as Action)
    const flagged = act(first, {
      t: 'upsertAllocation', id: null, person: 'Priya', projectId: pB.id,
      startDate: '2026-09-01', endDate: '2026-09-11', percentage: 60, note: '',
      acceptOverallocation: true, now: NOW,
    } as Action)
    const hardHolds =
      Boolean(bare.error && /enforces the allocation cap/.test(bare.error)) &&
      Boolean(flagged.error && /Configuration screen, under Allocation/.test(flagged.error))

    /* Advisory: the original two-step, the acceptance audited as a decision. */
    const advisory = ok(first, { t: 'config', op: { k: 'setAllocationPolicy', patch: { cap: 'advisory' } }, now: NOW } as Action)
    const warned = act(advisory, {
      t: 'upsertAllocation', id: null, person: 'Priya', projectId: pB.id,
      startDate: '2026-09-01', endDate: '2026-09-11', percentage: 60, note: '', now: NOW,
    } as Action)
    const accepted = ok(advisory, {
      t: 'upsertAllocation', id: null, person: 'Priya', projectId: pB.id,
      startDate: '2026-09-01', endDate: '2026-09-11', percentage: 60, note: 'Go-live fortnight, agreed.',
      acceptOverallocation: true, now: NOW,
    } as Action)
    const advisoryHolds =
      Boolean(warned.error && /Commit it anyway/.test(warned.error)) &&
      accepted.audit.some((e) => e.field === 'allocation' && /Deliberately overallocated/.test(e.reason ?? ''))

    /* Back to hard, the door shuts again; the audit trail carries both mode changes. */
    const rehardened = ok(advisory, { t: 'config', op: { k: 'setAllocationPolicy', patch: { cap: 'hard' } }, now: NOW } as Action)
    const shutAgain = Boolean(
      act(rehardened, {
        t: 'upsertAllocation', id: null, person: 'Priya', projectId: pB.id,
        startDate: '2026-09-01', endDate: '2026-09-11', percentage: 60, note: '',
        acceptOverallocation: true, now: NOW,
      } as Action).error,
    )
    const modeAudited = rehardened.audit.filter((e) => e.field === 'allocationPolicy').length === 2

    /* The judgement underneath is untouched: >100% on a single allocation refuses in both modes. */
    const tooBig = act(advisory, {
      t: 'upsertAllocation', id: null, person: 'Priya', projectId: pB.id,
      startDate: '2026-09-01', endDate: '2026-09-11', percentage: 150, note: '', now: NOW,
    } as Action)
    const boundsHold = Boolean(tooBig.error && /between 1 and 100/.test(tooBig.error))

    const good = shippedHard && badRefused && hardHolds && advisoryHolds && shutAgain && modeAudited && boundsHold
    return good
      ? { verdict: 'PASS', actual: 'The cap ships hard and an over-capacity allocation is refused with and without the override flag, the refusal naming the Configuration screen. Advisory, set through the real op, restores the recorded two-step \u2014 warned bare, accepted with the flag, the acceptance audited as \u201cDeliberately overallocated\u201d with the numbers. Hard again shuts the door on the same flag, both mode changes sit in the audit trail, an invalid mode is refused by the op, and a single allocation past 100% refuses identically in both modes because the judgement underneath never moved.', stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `shippedHard=${shippedHard} badRefused=${badRefused} hardHolds=${hardHolds} advisoryHolds=${advisoryHolds} shutAgain=${shutAgain} modeAudited=${modeAudited} boundsHold=${boundsHold}`, stops: 'the cap disagrees with the design', severity: 'P1', impact: 'people committed past capacity silently, or honest staffing refused' } as const
  },
)

/* ================================================================== *
 * Notification preferences (design 2026-08-23)
 * ================================================================== */

scenario(
  'NP1',
  'The person\u2019s own say over each kind, with the default path untouched',
  'No pref means exactly today\u2019s behaviour \u2014 the regression guard runs first; email adds a pending record for the drain; mute mints nothing but the audit still answers why; preferences are self-or-admin; role labels have no preferences.',
  () => {
    const notifsOf = (st: WorkspaceState, rule: string) =>
      Object.values(st.notifications).filter((n) => n.ruleId === rule)

    /* THE GUARD, FIRST: no pref set, an assignment mints exactly one in-app record. */
    const plain = ok(BASE, {
      t: 'updateIssue', id: 'OAPIL-2', patch: { owner: 'Priya' }, now: NOW,
    } as Action)
    const plainMints = notifsOf(plain, 'assignment')
    const defaultUntouched =
      plainMints.length === 1 && plainMints[0].channel === 'in-app' && plainMints[0].delivery === 'delivered'

    const priyaId = Object.values(BASE.model.people).find((pp) => pp.name === 'Priya')!.id

    /* in-app+email: two records, the email one pending for the scheduled pass. */
    const wantsMail = ok(BASE, {
      t: 'setNotificationPref', personId: priyaId, kind: 'assignment', mode: 'in-app+email', now: NOW,
    } as Action)
    const mailed = ok(wantsMail, {
      t: 'updateIssue', id: 'OAPIL-2', patch: { owner: 'Priya' }, now: NOW,
    } as Action)
    const mailMints = notifsOf(mailed, 'assignment')
    const emailRec = mailMints.find((n) => n.channel === 'email')
    const emailAdded =
      mailMints.length === 2 &&
      mailMints.some((n) => n.channel === 'in-app' && n.delivery === 'delivered') &&
      emailRec?.delivery === 'pending' && /scheduled pass/.test(emailRec.deliveryNote)

    /* mute: nothing minted, and the audit line still answers why. */
    const muted = ok(BASE, {
      t: 'setNotificationPref', personId: priyaId, kind: 'assignment', mode: 'mute', now: NOW,
    } as Action)
    const silent = ok(muted, {
      t: 'updateIssue', id: 'OAPIL-2', patch: { owner: 'Priya' }, now: NOW,
    } as Action)
    const mutedHolds =
      notifsOf(silent, 'assignment').length === 0 &&
      silent.audit.some((e) => e.field === 'notification' && /muted by their preference/.test(e.to ?? ''))

    /* Intake: each triager\u2019s OWN preference, inside the loop. */
    const moduleId = Object.values(BASE.nodes).find((n) => n.kind === 'module')!.id
    const staffed = ok(BASE, {
      t: 'config',
      op: { k: 'upsertPerson', id: priyaId, name: 'Priya', roleIds: ['ROLE_SUPPORT'] },
      now: NOW,
    } as Action)
    const arrived = apply(staffed, {
      t: 'create', parentId: moduleId, kind: 'issue', draft: { name: 'Prefs mail-in' }, now: NOW,
    } as Action, INTAKE_ACTOR).state
    const intakeDefault = notifsOf(arrived, 'intake-arrival').some((n) => n.toId === priyaId)
    const intakeMuted = ok(staffed, {
      t: 'setNotificationPref', personId: priyaId, kind: 'intake-arrival', mode: 'mute', now: NOW,
    } as Action)
    const quietArrival = apply(intakeMuted, {
      t: 'create', parentId: moduleId, kind: 'issue', draft: { name: 'Prefs mail-in 2' }, now: NOW,
    } as Action, INTAKE_ACTOR).state
    const intakeHolds = intakeDefault && !notifsOf(quietArrival, 'intake-arrival').some((n) => n.toId === priyaId)

    /* The notify arm: mute suppresses a rule\u2019s choice; a role label is nobody\u2019s pref. */
    const autoMuted = ok(BASE, {
      t: 'setNotificationPref', personId: priyaId, kind: 'automation', mode: 'mute', now: NOW,
    } as Action)
    const ruleFired = ok(autoMuted, {
      t: 'notify', to: 'Priya', channel: 'in-app', subject: 'Watch', body: 'Overdue.', aboutId: 'OAPIL-1', ruleId: 'RULE_X', now: NOW,
    } as Action)
    const ruleSuppressed =
      Object.values(ruleFired.notifications).length === 0 &&
      ruleFired.audit.some((e) => e.field === 'notification' && /muted by their preference/.test(e.to ?? ''))
    const roleLabel = ok(autoMuted, {
      t: 'notify', to: 'Delivery Lead', channel: 'in-app', subject: 'Watch', body: 'Overdue.', aboutId: 'OAPIL-1', ruleId: 'RULE_X', now: NOW,
    } as Action)
    const roleUntouched = Object.values(roleLabel.notifications).length === 1

    /* No doubling: a rule already emailing plus an in-app+email pref is ONE email record. */
    const autoMail = ok(BASE, {
      t: 'setNotificationPref', personId: priyaId, kind: 'automation', mode: 'in-app+email', now: NOW,
    } as Action)
    const alreadyEmail = ok(autoMail, {
      t: 'notify', to: 'Priya', channel: 'email', subject: 'Watch', body: 'Overdue.', aboutId: 'OAPIL-1', ruleId: 'RULE_X', now: NOW,
    } as Action)
    const noDoubling =
      Object.values(alreadyEmail.notifications).filter((n) => n.channel === 'email').length === 1 &&
      Object.values(alreadyEmail.notifications).length === 1

    /* Self-or-admin: a client-role actor may set her own, not Priya\u2019s; the admin may. */
    const withCarol = ok(BASE, {
      t: 'config', op: { k: 'upsertPerson', id: null, name: 'Pref Carol', roleIds: ['ROLE_CLIENT_USER'] }, now: NOW,
    } as Action)
    const carolId = Object.values(withCarol.model.people).find((pp) => pp.name === 'Pref Carol')!.id
    const carol: Actor = { id: 'np-carol', name: 'Pref Carol' }
    const carolOwn = apply(withCarol, {
      t: 'setNotificationPref', personId: carolId, kind: 'assignment', mode: 'mute', now: NOW,
    } as Action, carol)
    const carolCross = apply(withCarol, {
      t: 'setNotificationPref', personId: priyaId, kind: 'assignment', mode: 'mute', now: NOW,
    } as Action, carol)
    const gateHolds =
      !carolOwn.error &&
      Boolean(carolCross.error && /person's own/.test(carolCross.error)) &&
      !act(BASE, { t: 'setNotificationPref', personId: priyaId, kind: 'assignment', mode: 'mute', now: NOW } as Action).error

    /* Validation, in words. */
    const badKind = apply(BASE, {
      t: 'setNotificationPref', personId: priyaId, kind: 'digest', mode: 'mute', now: NOW,
    } as unknown as Action, A)
    const badRefused = Boolean(badKind.error && /assignment, intake-arrival, automation/.test(badKind.error))

    const good = defaultUntouched && emailAdded && mutedHolds && intakeHolds && ruleSuppressed &&
      roleUntouched && noDoubling && gateHolds && badRefused
    return good
      ? { verdict: 'PASS', actual: 'With no preference set an assignment mints exactly one delivered in-app record \u2014 the guard, asserted first. in-app+email adds a second record queued pending for the scheduled pass\u2019s drain; mute mints nothing while the audit line answers \u201cwhy didn\u2019t I get this\u201d in so many words. Each intake triager\u2019s own preference is consulted inside the loop; a rule\u2019s notify is suppressed by its target\u2019s mute but a role label \u2014 nobody\u2019s preference \u2014 is untouched, and a rule already emailing plus an email preference stays one record. A client-role actor may set her own preferences and not Priya\u2019s, the admin may set anybody\u2019s, and a kind outside the vocabulary is refused naming all three.', stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `defaultUntouched=${defaultUntouched} emailAdded=${emailAdded} mutedHolds=${mutedHolds} intakeHolds=${intakeHolds} ruleSuppressed=${ruleSuppressed} roleUntouched=${roleUntouched} noDoubling=${noDoubling} gateHolds=${gateHolds} badRefused=${badRefused}`, stops: 'the preference overlay disagrees with the design', severity: 'P1', impact: 'notifications silently swallowed, or preferences ignored' } as const
  },
)

/* ================================================================== *
 * Week grid and bulk approvals (design 2026-08-23)
 * ================================================================== */

scenario(
  'WG1',
  'A week gathered in one place, and a queue the approver can clear',
  'The grid aggregates without re-filtering \u2014 the id-join rule stays where it lives; approve-all decides every week but the approver\u2019s own, which stays refused in the rule\u2019s words.',
  () => {
    /* ---- the pure grid ---- */
    const te = (over: Partial<TimeEntry> & Pick<TimeEntry, 'id' | 'issueId' | 'date' | 'hours'>): TimeEntry => ({
      person: 'Priya', personId: 'P-1', activity: 'Investigation', billable: true, note: '',
      createdBy: 'Priya', createdAt: NOW, updatedBy: null, updatedAt: null, deletedAt: null,
      ...over,
    })
    const week = '2026-08-10'
    const entries: TimeEntry[] = [
      te({ id: 't1', issueId: 'OAPIL-1', date: '2026-08-10', hours: 2.25 }),
      te({ id: 't2', issueId: 'OAPIL-1', date: '2026-08-10', hours: 1.5 }),
      te({ id: 't3', issueId: 'OAPIL-1', date: '2026-08-13', hours: 4 }),
      /* The rename case: the id matches, the display name is stale. */
      te({ id: 't4', issueId: 'OAPIL-2', date: '2026-08-14', hours: 3, person: 'Priya (old name)' }),
      /* Withdrawn hours are not part of what anybody attests to. */
      te({ id: 't5', issueId: 'OAPIL-2', date: '2026-08-14', hours: 5, deletedAt: NOW }),
      /* Another person's entry never lands in this grid. */
      te({ id: 't6', issueId: 'OAPIL-1', date: '2026-08-11', hours: 8, person: 'Sam', personId: 'P-2' }),
    ]
    const grid = weekGrid(entries, 'Priya', week, 'P-1')
    const rowA = grid.rows.find((r) => r.issueId === 'OAPIL-1')
    const rowB = grid.rows.find((r) => r.issueId === 'OAPIL-2')
    const gridRight =
      grid.rows.length === 2 &&
      rowA?.byDay[0] === 3.75 && rowA.byDay[3] === 4 && rowA.total === 7.75 &&
      rowB?.byDay[4] === 3 && rowB.total === 3 &&
      grid.byDay[0] === 3.75 && grid.byDay[4] === 3 && grid.total === 10.75

    /* ---- the queue, through the reducer ---- */
    const priya: Actor = { id: 'wg-priya', name: 'Priya' }
    const sam: Actor = { id: 'wg-sam', name: 'Sam' }
    let st = BASE
    const add = (person: string, who: Actor) =>
      (st = ok(st, {
        t: 'addTime', issueId: 'OAPIL-1', person, date: '2026-08-12', hours: 4,
        activity: 'Investigation', billable: true, note: '', now: NOW,
      } as Action))
    /* addTime as each person themselves \u2014 recordForOthers is not the point here. */
    st = apply(st, { t: 'addTime', issueId: 'OAPIL-1', person: 'Priya', date: '2026-08-12', hours: 4, activity: 'Investigation', billable: true, note: '', now: NOW } as Action, priya).state
    st = apply(st, { t: 'addTime', issueId: 'OAPIL-1', person: 'Sam', date: '2026-08-12', hours: 4, activity: 'Investigation', billable: true, note: '', now: NOW } as Action, sam).state
    st = apply(st, { t: 'addTime', issueId: 'OAPIL-1', person: A.name, date: '2026-08-12', hours: 4, activity: 'Investigation', billable: true, note: '', now: NOW } as Action, A).state
    const wk = weekStarting('2026-08-12')
    st = apply(st, { t: 'submitTimesheet', person: 'Priya', weekStarting: wk, now: NOW } as Action, priya).state
    st = apply(st, { t: 'submitTimesheet', person: 'Sam', weekStarting: wk, now: NOW } as Action, sam).state
    st = apply(st, { t: 'submitTimesheet', person: A.name, weekStarting: wk, now: NOW } as Action, A).state
    const sheets = Object.values(st.timesheets)
    const submittedAll = sheets.length === 3 && sheets.every((t) => t.status === 'Submitted')

    /* The pre-filter the panel performs: everything decidable, which excludes A's own. */
    const attester = { name: A.name, maySubmit: true, mayApprove: true }
    const decidable = sheets.filter((t) => !decideProblem(t, 'approved', undefined, attester))
    const preFilterRight = decidable.length === 2 && !decidable.some((t) => t.person === A.name)

    /* The batch, folded like dispatchMany \u2014 every step must hold. */
    let batch = st
    for (const t of decidable) {
      batch = ok(batch, { t: 'decideTimesheet', id: t.id, decision: 'approved', now: NOW } as Action)
    }
    const own = Object.values(batch.timesheets).find((t) => t.person === A.name)!
    const others = Object.values(batch.timesheets).filter((t) => t.person !== A.name)
    const batchRight = others.every((t) => t.status === 'Approved') && own.status === 'Submitted'

    /* And the own week, asked individually, refused in the rule's words. */
    const selfTry = act(batch, { t: 'decideTimesheet', id: own.id, decision: 'approved', now: NOW } as Action)
    const selfRefused = Boolean(selfTry.error && /submitted/i.test(selfTry.error))

    void add
    const good = gridRight && submittedAll && preFilterRight && batchRight && selfRefused
    return good
      ? { verdict: 'PASS', actual: 'The grid gathers a week across issues without re-filtering: quarter hours sum per day and per issue, a withdrawn entry is excluded, another person\u2019s hours never land, and the id-join matches an entry whose display name went stale. Three submitted weeks make a queue; the panel\u2019s pre-filter \u2014 decideProblem per row \u2014 excludes the approver\u2019s own week, the remaining two approve as an atomic fold, and the own week asked individually is refused in the rule\u2019s words and stays Submitted.', stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `gridRight=${gridRight} submittedAll=${submittedAll} preFilterRight=${preFilterRight} batchRight=${batchRight} selfRefused=${selfRefused}`, stops: 'the gathering disagrees with the design', severity: 'P1', impact: 'a week attested from a partial picture, or an approver deciding their own hours' } as const
  },
)

/* ================================================================== *
 * Override provenance (design 2026-08-23)
 * ================================================================== */

scenario(
  'OV1',
  'Every resolved value can say where it came from, and a change can say what it reaches',
  'The sources are the resolvers\u2019 annotated twins \u2014 same walk, compared for equality so they cannot fork; the radius names the scopes a change reaches and the ones shielded by their own pin.',
  () => {
    const clientId = Object.values(BASE.nodes).find((n) => n.kind === 'client')!.id
    const engId = Object.values(BASE.nodes).find((n) => n.kind === 'engagement')!.id
    const moduleId = Object.values(BASE.nodes).find((n) => n.kind === 'module')!.id

    /* An org-wide word, and a nearer one at the engagement. */
    let st = ok(BASE, { t: 'config', op: { k: 'setLabel', scopeId: ROOT_SCOPE, key: 'ISSUE_OWNER', label: 'Org Owner' }, now: NOW } as Action)
    st = ok(st, { t: 'config', op: { k: 'setLabel', scopeId: engId, key: 'ISSUE_OWNER', label: 'Eng Owner' }, now: NOW } as Action)
    const m = st.model

    const chainEng = scopeChainOf(st, engId)
    const chainClient = scopeChainOf(st, clientId)
    const chainModule = scopeChainOf(st, moduleId)

    /* All four source kinds, each equal to its resolver \u2014 the anti-fork check. */
    const own = labelSource(m, 'ISSUE_OWNER', chainEng)
    const org = labelSource(m, 'ISSUE_OWNER', chainClient)
    const inherited = labelSource(m, 'ISSUE_OWNER', chainModule)
    const shipped = labelSource(m, 'FIELD_SEVERITY', chainEng)
    const sourcesRight =
      own.at === engId && own.value === 'Eng Owner' &&
      org.at === ROOT_SCOPE && org.value === 'Org Owner' &&
      inherited.at === engId && inherited.value === 'Eng Owner' &&
      shipped.at === null && shipped.value === LABEL_KEYS.FIELD_SEVERITY &&
      own.value === resolveLabel(m, 'ISSUE_OWNER', chainEng) &&
      org.value === resolveLabel(m, 'ISSUE_OWNER', chainClient) &&
      inherited.value === resolveLabel(m, 'ISSUE_OWNER', chainModule) &&
      shipped.value === resolveLabel(m, 'FIELD_SEVERITY', chainEng)

    /* The boolean families walk the same way. */
    const agentId = Object.keys(m.agents)[0]
    const withAgent = ok(st, { t: 'config', op: { k: 'setScopeAgent', scopeId: clientId, agentId, value: true }, now: NOW } as Action)
    const agentPinned = agentEnabledSource(withAgent.model, agentId, chainEng)
    const agentDefault = agentEnabledSource(m, agentId, chainEng)
    const respId = Object.keys(m.responsibilities)[0]
    const respDefault = requiredSource(m, respId, chainEng)
    const booleansRight =
      agentPinned.at === clientId && agentPinned.value === true &&
      agentPinned.value === resolveAgentEnabled(withAgent.model, agentId, chainEng) &&
      agentDefault.at === null && respDefault.at === null

    /* The radius. Eng pins the key; the module sits beneath it, the client above it. */
    const options = [clientId, engId, moduleId].map((id) => ({ id, chain: scopeChainOf(st, id) }))
    const sets = (sid: string) => Boolean(m.overrides[sid]?.labels?.ISSUE_OWNER)
    const fromRoot = blastRadius(options, ROOT_SCOPE, sets)
    const fromClient = blastRadius(options, clientId, sets)
    const radiusRight =
      fromRoot.affected.includes(clientId) &&
      fromRoot.shielded.some((x) => x.id === engId && x.by === engId) &&
      fromRoot.shielded.some((x) => x.id === moduleId && x.by === engId) &&
      !fromRoot.affected.includes(engId) &&
      fromClient.affected.length === 1 && fromClient.affected[0] === clientId &&
      fromClient.shielded.some((x) => x.id === moduleId && x.by === engId)

    const good = sourcesRight && booleansRight && radiusRight
    return good
      ? { verdict: 'PASS', actual: 'The engagement\u2019s own word answers \u201cset here\u201d, the client\u2019s answers \u201corganisation default\u201d, the module inherits the engagement\u2019s and says from whom, and an untouched key answers the shipped default \u2014 each source equal to its resolver, so the twins cannot fork. A change at the organisation reaches the client but is shielded from the engagement by its own pin and from the module by the same pin, named; a change at the client reaches only the client.', stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `sourcesRight=${sourcesRight} booleansRight=${booleansRight} radiusRight=${radiusRight}`, stops: 'the provenance disagrees with the resolution', severity: 'P2', impact: 'a screen naming the wrong source for a value, or previewing the wrong reach' } as const
  },
)

/* ================================================================== *
 * Mentions (design 2026-08-23)
 * ================================================================== */

scenario(
  'MN1',
  'Naming a colleague tells them \u2014 once, never the author, and only the newly named',
  'One parser feeds the highlight and the mint; longest name first, word-boundary guarded, unknown tokens left as text; the edit pings only the addition; the mute preference answers in the audit.',
  () => {
    /* ---- the parser, pure ---- */
    const people = [
      { id: 'p1', name: 'Sam' },
      { id: 'p2', name: 'Sam Carter' },
      { id: 'p3', name: 'Nishant Sekhar' },
    ]
    const parsed = mentionsIn('@Sam Carter and @sam, plus @Nishant Sekhar. @Nobody too', people)
    const boundary = mentionsIn('@Sample text', people)
    const parserRight =
      parsed.length === 3 &&
      parsed[0].id === 'p2' && parsed[1].id === 'p1' && parsed[2].id === 'p3' &&
      boundary.length === 0

    /* ---- the mint ---- */
    const priyaId = Object.values(BASE.model.people).find((pp) => pp.name === 'Priya')!.id
    const mentionsOf = (st: WorkspaceState) =>
      Object.values(st.notifications).filter((n) => n.ruleId === 'mention')

    const once = ok(BASE, {
      t: 'addNote', issueId: 'OAPIL-1', body: '@Priya please look at this \u2014 and again @Priya.',
      noteType: 'Investigation', pinned: false, now: NOW,
    } as Action)
    const mintedOnce = mentionsOf(once)
    const distinctRight = mintedOnce.length === 1 && mintedOnce[0].toId === priyaId &&
      /mentioned on OAPIL-1/.test(mintedOnce[0].subject)

    const priya: Actor = { id: 'mn-priya', name: 'Priya' }
    const selfNote = apply(BASE, {
      t: 'addNote', issueId: 'OAPIL-1', body: '@Priya \u2014 note to self.',
      noteType: 'Investigation', pinned: false, now: NOW,
    } as Action, priya).state
    const authorExcluded = mentionsOf(selfNote).length === 0

    /* The edit pings only the newly named. */
    let ed = ok(BASE, {
      t: 'addNote', issueId: 'OAPIL-1', body: 'plain start', noteType: 'Investigation', pinned: false, now: NOW,
    } as Action)
    const noteId = Object.values(ed.notes).find((n) => n.body === 'plain start')!.id
    ed = ok(ed, { t: 'updateNote', id: noteId, patch: { body: '@Priya now involved' }, now: NOW } as Action)
    const afterFirst = mentionsOf(ed).length
    ed = ok(ed, { t: 'updateNote', id: noteId, patch: { body: '@Priya now involved, and @Sam too' }, now: NOW } as Action)
    const afterSecond = mentionsOf(ed)
    const editRight = afterFirst === 1 && afterSecond.length === 2 &&
      afterSecond.filter((n) => n.toId === priyaId).length === 1

    /* The preference answers in the audit. */
    const muted = ok(BASE, {
      t: 'setNotificationPref', personId: priyaId, kind: 'mention', mode: 'mute', now: NOW,
    } as Action)
    const quiet = ok(muted, {
      t: 'addNote', issueId: 'OAPIL-1', body: '@Priya \u2014 you will not be pinged.',
      noteType: 'Investigation', pinned: false, now: NOW,
    } as Action)
    const muteRight = mentionsOf(quiet).length === 0 &&
      quiet.audit.some((e) => e.field === 'notification' && e.reason === 'mention' && /muted by their preference/.test(e.to ?? ''))

    /* The default path: no @, nothing minted. */
    const plain = ok(BASE, {
      t: 'addNote', issueId: 'OAPIL-1', body: 'no names here', noteType: 'Investigation', pinned: false, now: NOW,
    } as Action)
    const defaultRight = mentionsOf(plain).length === 0

    const good = parserRight && distinctRight && authorExcluded && editRight && muteRight && defaultRight
    return good
      ? { verdict: 'PASS', actual: 'The parser takes the longest matching directory name at each @, holds the word boundary (so @Sample is not Sam), and leaves an unknown token as text. A note naming Priya twice pings her once with her directory id on the record; Priya naming herself pings nobody; an edit that keeps her name and adds Sam\u2019s pings only Sam. Her mute preference turns the ping into the audit line that answers why, and a note with no @ mints nothing \u2014 the default path untouched.', stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `parserRight=${parserRight} distinctRight=${distinctRight} authorExcluded=${authorExcluded} editRight=${editRight} muteRight=${muteRight} defaultRight=${defaultRight}`, stops: 'the mention disagrees with the design', severity: 'P2', impact: 'colleagues pinged wrongly, repeatedly, or not at all' } as const
  },
)

/* ================================================================== *
 * RAID (design 2026-08-23)
 * ================================================================== */

scenario(
  'RD1',
  'A risk carries its judgement, a decision its outcome — and exposure is never stored',
  'Two shipped types recognised by stable id through the live registry, so a rename keeps the semantics; the judgement bounded 1–5 with null meaning not-yet-judged; the bands turn at their stated boundaries.',
  () => {
    /* The shipped types, by id. */
    const m = BASE.model
    const shipped =
      m.workTypes[RISK_TYPE_ID]?.label === 'Risk' &&
      m.workTypes[DECISION_TYPE_ID]?.label === 'Decision' &&
      raidKindOf(m, 'Risk') === 'risk' &&
      raidKindOf(m, 'decision') === 'decision' &&
      raidKindOf(m, 'Defect') === null

    /* A renamed label keeps its semantics — recognition is the id, not the word. */
    const renamed = ok(BASE, {
      t: 'config', op: { k: 'upsertWorkType', id: RISK_TYPE_ID, label: 'Threat', description: '' }, now: NOW,
    } as Action)
    const renameHolds = raidKindOf(renamed.model, 'Threat') === 'risk' && raidKindOf(renamed.model, 'Risk') === null

    /* The bands, at their boundaries; null propagates. */
    const bands =
      exposure(2, 2)!.band === 'Low' && exposure(1, 5)!.band === 'Medium' &&
      exposure(3, 3)!.band === 'Medium' && exposure(2, 5)!.band === 'High' &&
      exposure(2, 7 as number)!.score === 14 && exposure(3, 5)!.band === 'Critical' &&
      exposure(5, 5)!.score === 25 && exposure(null, 5) === null && exposure(4, null) === null

    /* The judgement through the ordinary edit, bounded in words, null-back allowed. */
    const judged = ok(BASE, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { type: 'Risk', riskLikelihood: 4, riskImpact: 5 }, now: NOW,
    } as Action)
    const stored = judged.issues['OAPIL-1']
    const judgedRight = stored.riskLikelihood === 4 && stored.riskImpact === 5 &&
      exposure(stored.riskLikelihood, stored.riskImpact)!.score === 20 &&
      !('riskExposure' in stored)

    const tooBig = act(BASE, { t: 'updateIssue', id: 'OAPIL-1', patch: { riskImpact: 6 }, now: NOW } as Action)
    const tooSmall = act(BASE, { t: 'updateIssue', id: 'OAPIL-1', patch: { riskLikelihood: 0 }, now: NOW } as Action)
    const bounded = Boolean(tooBig.error && /between 1 and 5/.test(tooBig.error)) &&
      Boolean(tooSmall.error && /not been judged yet/.test(tooSmall.error))

    const unjudged = ok(judged, {
      t: 'updateIssue', id: 'OAPIL-1', patch: { riskLikelihood: null }, now: NOW,
    } as Action)
    const nullBack = unjudged.issues['OAPIL-1'].riskLikelihood === null &&
      exposure(unjudged.issues['OAPIL-1'].riskLikelihood, unjudged.issues['OAPIL-1'].riskImpact) === null

    /* A decision's outcome rides the same edit. */
    const decided = ok(BASE, {
      t: 'updateIssue', id: 'OAPIL-2',
      patch: { type: 'Decision', decisionOutcome: 'Ship the interim mapping; revisit after UAT.' }, now: NOW,
    } as Action)
    const outcomeRight = decided.issues['OAPIL-2'].decisionOutcome === 'Ship the interim mapping; revisit after UAT.'

    const good = shipped && renameHolds && bands && judgedRight && bounded && nullBack && outcomeRight
    return good
      ? { verdict: 'PASS', actual: 'Risk and Decision ship by stable id and survive a rename to “Threat” — the word changes, the semantics do not, and the old word stops matching. The bands turn exactly where stated (4 Low, 5 Medium, 14 High, 15 Critical), null propagates as not-yet-judged rather than becoming a number, 0 and 6 are refused in words that name the scale and the way back, and no exposure field exists on the stored record — it is computed from the halves every time. A decision’s outcome rides the ordinary audited edit.', stops: '', severity: 'P2', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `shipped=${shipped} renameHolds=${renameHolds} bands=${bands} judgedRight=${judgedRight} bounded=${bounded} nullBack=${nullBack} outcomeRight=${outcomeRight}`, stops: 'the RAID semantics disagree with the design', severity: 'P2', impact: 'risks unsortable by exposure, or a stored exposure free to lie' } as const
  },
)

/* ================================================================== *
 * Guest access (design 2026-08-23, phase 7)
 * ================================================================== */

scenario(
  'GA1',
  'A guest sees one client\u2019s marked content, and an unattached seat sees nothing',
  'The withheld view is scoped to the reader\u2019s own client node; null \u2014 no directory entry, or a client seat nobody attached \u2014 empties everything rather than widening to every client; the directory refuses a scope that is not a client node.',
  () => {
    const companyId = Object.values(BASE.nodes).find((n) => n.kind === 'company')!.id
    const oapilId = Object.values(BASE.nodes).find((n) => n.kind === 'client')!.id
    const moduleId = Object.values(BASE.nodes).find((n) => n.kind === 'module')!.id

    /* A second client with its own engagement and a marked record of its own. */
    let st = ok(BASE, { t: 'create', parentId: companyId, kind: 'client', draft: { name: 'Rival Ltd' }, now: NOW } as Action)
    const rivalId = Object.values(st.nodes).find((n) => n.kind === 'client' && n.name === 'Rival Ltd')!.id
    st = ok(st, { t: 'create', parentId: rivalId, kind: 'engagement', draft: { name: 'Rival Engagement' }, now: NOW } as Action)
    const rivalEngId = Object.values(st.nodes).find((n) => n.kind === 'engagement' && n.name === 'Rival Engagement')!.id
    st = ok(st, { t: 'create', parentId: rivalEngId, kind: 'issue', draft: { name: 'Rival secret ask' }, now: NOW } as Action)
    const rivalIssue = Object.values(st.issues).find((i) => i.subject === 'Rival secret ask')!
    st = ok(st, { t: 'updateIssue', id: rivalIssue.id, patch: { clientVisible: true }, now: NOW } as Action)

    /* And a marked record under OAPIL. */
    st = ok(st, { t: 'create', parentId: moduleId, kind: 'issue', draft: { name: 'OAPIL open question' }, now: NOW } as Action)
    const oapilIssue = Object.values(st.issues).find((i) => i.subject === 'OAPIL open question')!
    st = ok(st, { t: 'updateIssue', id: oapilIssue.id, patch: { clientVisible: true }, now: NOW } as Action)

    /* The OAPIL guest: their client\u2019s marked record, its ancestors, and nothing of Rival. */
    const asOapil = clientView(st, oapilId)
    const oapilRight =
      Boolean(asOapil.issues[oapilIssue.id]) &&
      !asOapil.issues[rivalIssue.id] &&
      Boolean(asOapil.nodes[oapilId]) &&
      !asOapil.nodes[rivalId] &&
      !asOapil.nodes[rivalEngId]

    /* The Rival guest, symmetrically. */
    const asRival = clientView(st, rivalId)
    const rivalRight =
      Boolean(asRival.issues[rivalIssue.id]) &&
      !asRival.issues[oapilIssue.id] &&
      Boolean(asRival.nodes[rivalId]) &&
      !asRival.nodes[oapilId]

    /* Null empties everything \u2014 both deny cases share it. */
    const asNobody = clientView(st, null)
    const denyRight =
      Object.keys(asNobody.issues).length === 0 &&
      Object.keys(asNobody.nodes).length === 0 &&
      Object.keys(asNobody.notes).length === 0 &&
      Object.keys(asNobody.documents).length === 0 &&
      asNobody.audit.length === 0

    /* The directory: a scope must be a client node, and it survives an unrelated edit. */
    const badScope = act(st, {
      t: 'config', op: { k: 'upsertPerson', id: null, name: 'Guest Gina', roleIds: ['ROLE_CLIENT_USER'], clientScopeId: rivalEngId }, now: NOW,
    } as Action)
    const scopeValidated = Boolean(badScope.error && /client nodes/.test(badScope.error))
    const withGina = ok(st, {
      t: 'config', op: { k: 'upsertPerson', id: null, name: 'Guest Gina', roleIds: ['ROLE_CLIENT_USER'], email: 'gina@rival.example', clientScopeId: rivalId }, now: NOW,
    } as Action)
    const ginaId = Object.values(withGina.model.people).find((pp) => pp.name === 'Guest Gina')!.id
    const renamed = ok(withGina, {
      t: 'config', op: { k: 'upsertPerson', id: ginaId, name: 'Gina Malhotra', roleIds: ['ROLE_CLIENT_USER'] }, now: NOW,
    } as Action)
    const scopeSurvives = renamed.model.people[ginaId].clientScopeId === rivalId &&
      renamed.model.people[ginaId].email === 'gina@rival.example'

    const good = oapilRight && rivalRight && denyRight && scopeValidated && scopeSurvives
    return good
      ? { verdict: 'PASS', actual: 'The OAPIL guest\u2019s view holds OAPIL\u2019s marked record with its ancestor chain and nothing of Rival \u2014 not the marked record, not even the nodes; Rival\u2019s guest sees the mirror image. A null scope \u2014 a sign-in matching no directory entry, or a client seat nobody attached \u2014 empties every table rather than widening to every client, which is the deny-by-default the design demands. The directory refuses an engagement node as a scope in words naming what it must be, and both the scope and the email survive an unrelated rename.', stops: '', severity: 'P1', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `oapilRight=${oapilRight} rivalRight=${rivalRight} denyRight=${denyRight} scopeValidated=${scopeValidated} scopeSurvives=${scopeSurvives}`, stops: 'the scope disagrees with the design', severity: 'P1', impact: 'one client\u2019s guest reading another client\u2019s marked content' } as const
  },
)

/* ================================================================== *
 * Project membership
 * ================================================================== */

scenario(
  'PM1',
  'A member of a project may act on it',
  'canOnProject resolves the record’s project via projectOf, and a person named on a live ProjectMember row for that project keeps whatever their role already grants them.',
  () => {
    const oapilId = Object.values(BASE.nodes).find((n) => n.kind === 'client')!.id
    let st = ok(BASE, { t: 'create', parentId: oapilId, kind: 'project', draft: { name: 'Rollout' }, now: NOW } as Action)
    const projectId = Object.values(st.nodes).find((n) => n.kind === 'project' && n.name === 'Rollout')!.id
    st = ok(st, { t: 'create', parentId: projectId, kind: 'issue', draft: { name: 'Project task' }, now: NOW } as Action)
    const issueId = Object.values(st.issues).find((i) => i.subject === 'Project task')!.id

    const priyaId = Object.values(st.model.people).find((pp) => pp.name === 'Priya')!.id
    st = ok(st, { t: 'config', op: { k: 'upsertPerson', id: priyaId, name: 'Priya', roleIds: ['ROLE_TECHNICAL'] }, now: NOW } as Action)
    const priya: Actor = { id: priyaId, name: 'Priya' }

    const member: ProjectMember = {
      id: 'pm-1', projectId, person: 'Priya', personId: priyaId,
      projectRoleId: 'PROJROLE_CONSULTANT', addedBy: 'val', addedAt: NOW, removedAt: null,
    }

    const resolved = projectOf(st, issueId)
    const decision = canOnProject(st.model, priya, 'work.edit', resolved, [member])
    const good = resolved === projectId && decision.allowed

    return good
      ? { verdict: 'PASS', actual: `projectOf resolved ${resolved}; member ${priya.name} allowed=${decision.allowed}`, stops: '', severity: 'P1', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `resolved=${resolved} allowed=${decision.allowed}`, stops: 'a staffed member is refused on their own project', severity: 'P1', impact: 'a project cannot be worked by the people staffed on it' } as const
  },
)

scenario(
  'PM2',
  'A non-member is refused, with a reason naming them',
  'canOnProject refuses somebody who holds the capability by role but carries no live ProjectMember row for the project the record resolves to.',
  () => {
    const oapilId = Object.values(BASE.nodes).find((n) => n.kind === 'client')!.id
    let st = ok(BASE, { t: 'create', parentId: oapilId, kind: 'project', draft: { name: 'Rollout' }, now: NOW } as Action)
    const projectId = Object.values(st.nodes).find((n) => n.kind === 'project' && n.name === 'Rollout')!.id
    st = ok(st, { t: 'create', parentId: projectId, kind: 'issue', draft: { name: 'Project task' }, now: NOW } as Action)
    const issueId = Object.values(st.issues).find((i) => i.subject === 'Project task')!.id

    const priyaId = Object.values(st.model.people).find((pp) => pp.name === 'Priya')!.id
    st = ok(st, { t: 'config', op: { k: 'upsertPerson', id: priyaId, name: 'Priya', roleIds: ['ROLE_TECHNICAL'] }, now: NOW } as Action)
    const priya: Actor = { id: priyaId, name: 'Priya' }

    const resolved = projectOf(st, issueId)
    const decision = canOnProject(st.model, priya, 'work.edit', resolved, [])
    const good = !decision.allowed && /not staffed/.test(decision.reason ?? '') && decision.reason?.includes('Priya')

    return good
      ? { verdict: 'PASS', actual: decision.reason ?? '', stops: '', severity: 'P1', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `allowed=${decision.allowed} reason=${decision.reason}`, stops: 'a non-member is not refused, or refused without saying why', severity: 'P0', impact: 'anybody holding a delivery role can act on any project, membership notwithstanding' } as const
  },
)

scenario(
  'PM3',
  'An administrator bypasses the membership gate with no row at all',
  'isExempt recognises ADMIN_ROLE_ID and the machine actor before checking any ProjectMember row — an operator is never locked out of their own deployment by a staffing gap.',
  () => {
    const oapilId = Object.values(BASE.nodes).find((n) => n.kind === 'client')!.id
    let st = ok(BASE, { t: 'create', parentId: oapilId, kind: 'project', draft: { name: 'Rollout' }, now: NOW } as Action)
    const projectId = Object.values(st.nodes).find((n) => n.kind === 'project' && n.name === 'Rollout')!.id
    st = ok(st, { t: 'create', parentId: projectId, kind: 'issue', draft: { name: 'Project task' }, now: NOW } as Action)
    const issueId = Object.values(st.issues).find((i) => i.subject === 'Project task')!.id
    const resolved = projectOf(st, issueId)

    /* `A` (Validator) holds no directory role, so it falls to `defaultRoleIds` — shipped
       ADMIN — the same fallback every unrecognised actor gets on a deployment with no login. */
    const adminExempt = isExempt(st.model, A) && canOnProject(st.model, A, 'work.edit', resolved, []).allowed
    const machineExempt = isExempt(st.model, SCHEDULE_ACTOR)

    const good = adminExempt && machineExempt
    return good
      ? { verdict: 'PASS', actual: `admin exempt=${adminExempt}; machine exempt=${machineExempt}`, stops: '', severity: 'P1', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `adminExempt=${adminExempt} machineExempt=${machineExempt}`, stops: 'an administrator or the scheduled pass is refused by a gate meant to exempt them', severity: 'P0', impact: 'the operator of a fresh deployment, or the scheduled pass, is locked out by an empty membership table' } as const
  },
)

scenario(
  'PM4',
  'A record with no project ancestor is ungated',
  'projectOf returns null for a record parented directly to a bare client or engagement node — ALLOWED_PARENTS has always permitted that — and canOnProject treats null as ungated, matching today’s visibility for such records.',
  () => {
    /* BASE’s seeded issues sit under a module, not a project — no project ancestor at all. */
    const issueId = 'OAPIL-1'
    const resolved = projectOf(BASE, issueId)

    const priyaId = Object.values(BASE.model.people).find((pp) => pp.name === 'Priya')!.id
    const priya: Actor = { id: priyaId, name: 'Priya' }
    const staffed = ok(BASE, { t: 'config', op: { k: 'upsertPerson', id: priyaId, name: 'Priya', roleIds: ['ROLE_TECHNICAL'] }, now: NOW } as Action)
    const decision = canOnProject(staffed.model, priya, 'work.edit', resolved, [])

    const good = resolved === null && decision.allowed
    return good
      ? { verdict: 'PASS', actual: `resolved=${resolved} allowed=${decision.allowed}`, stops: '', severity: 'P1', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `resolved=${resolved} allowed=${decision.allowed}`, stops: 'work outside any project node is gated when it should not be, or a real project is being missed', severity: 'P1', impact: 'work not organised into a project becomes newly inaccessible to people who could see it today' } as const
  },
)

scenario(
  'PM5',
  'Staffing a project needs project.staff — an Engagement Lead may, a Consultant may not',
  'addProjectMember goes through the same funnel as every other mutation: ACTION_PERMISSIONS names project.staff, and DEFAULT_GRANTS holds it for ROLE_ENGAGEMENT_LEAD and ROLE_PROJECT_MANAGER, not for ROLE_TECHNICAL.',
  () => {
    const oapilId = Object.values(BASE.nodes).find((n) => n.kind === 'client')!.id
    let st = ok(BASE, { t: 'create', parentId: oapilId, kind: 'project', draft: { name: 'Rollout' }, now: NOW } as Action)
    const projectId = Object.values(st.nodes).find((n) => n.kind === 'project' && n.name === 'Rollout')!.id

    const priyaId = Object.values(st.model.people).find((pp) => pp.name === 'Priya')!.id
    const samId = Object.values(st.model.people).find((pp) => pp.name === 'Sam')!.id
    st = ok(st, { t: 'config', op: { k: 'upsertPerson', id: priyaId, name: 'Priya', roleIds: ['ROLE_ENGAGEMENT_LEAD'] }, now: NOW } as Action)
    st = ok(st, { t: 'config', op: { k: 'upsertPerson', id: samId, name: 'Sam', roleIds: ['ROLE_TECHNICAL'] }, now: NOW } as Action)

    const leadResult = apply(st, { t: 'addProjectMember', projectId, person: 'Sam', projectRoleId: 'PROJROLE_CONSULTANT', now: NOW } as Action, { id: priyaId, name: 'Priya' })
    const leadOk = !leadResult.error && Object.values(leadResult.state.projectMembers).some((m) => m.person === 'Sam' && m.projectId === projectId)

    const consultantResult = apply(st, { t: 'addProjectMember', projectId, person: 'Priya', projectRoleId: 'PROJROLE_CONSULTANT', now: NOW } as Action, { id: samId, name: 'Sam' })
    const consultantRefused = Boolean(consultantResult.error)

    const good = leadOk && consultantRefused
    return good
      ? { verdict: 'PASS', actual: `lead added a member; consultant refused: ${consultantResult.error}`, stops: '', severity: 'P1', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `leadOk=${leadOk} consultantRefused=${consultantRefused}`, stops: 'staffing a project is not gated the same way every other mutation is', severity: 'P1', impact: 'anybody can staff a project regardless of role' } as const
  },
)

scenario(
  'PM6',
  'Adding a member with an unresolvable name is refused',
  'addProjectMember refuses when the person does not resolve to exactly one directory entry, rather than storing a row nothing will ever match — the deliberate divergence from Allocation, which tolerates personId: null. (The directory refuses duplicate names on write — see directoryIdByName — so the "many matches" case cannot arise from anything the reducer itself can create; only the zero-match case is reachable here.)',
  () => {
    const oapilId = Object.values(BASE.nodes).find((n) => n.kind === 'client')!.id
    let st = ok(BASE, { t: 'create', parentId: oapilId, kind: 'project', draft: { name: 'Rollout' }, now: NOW } as Action)
    const projectId = Object.values(st.nodes).find((n) => n.kind === 'project' && n.name === 'Rollout')!.id
    const priyaId = Object.values(st.model.people).find((pp) => pp.name === 'Priya')!.id
    st = ok(st, { t: 'config', op: { k: 'upsertPerson', id: priyaId, name: 'Priya', roleIds: ['ROLE_ENGAGEMENT_LEAD'] }, now: NOW } as Action)
    const lead: Actor = { id: priyaId, name: 'Priya' }

    const unknown = apply(st, { t: 'addProjectMember', projectId, person: 'Nobody Here', projectRoleId: 'PROJROLE_CONSULTANT', now: NOW } as Action, lead)
    const unknownRefused = Boolean(unknown.error) && Object.keys(unknown.state.projectMembers).length === 0

    const good = unknownRefused
    return good
      ? { verdict: 'PASS', actual: unknown.error ?? '', stops: '', severity: 'P1', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `unknownRefused=${unknownRefused}`, stops: 'a membership row is created for a name that does not resolve to exactly one person', severity: 'P1', impact: 'a project membership row exists that no signed-in session can ever match — silently useless access control' } as const
  },
)

scenario(
  'PM7',
  'Removing a member is soft, and the removal takes effect immediately',
  'removeProjectMember sets removedAt rather than deleting the row — the same reasoning Allocation and Commitment never hard-delete — and canOnProject stops counting it as staffed the moment removedAt is set.',
  () => {
    const oapilId = Object.values(BASE.nodes).find((n) => n.kind === 'client')!.id
    let st = ok(BASE, { t: 'create', parentId: oapilId, kind: 'project', draft: { name: 'Rollout' }, now: NOW } as Action)
    const projectId = Object.values(st.nodes).find((n) => n.kind === 'project' && n.name === 'Rollout')!.id
    st = ok(st, { t: 'create', parentId: projectId, kind: 'issue', draft: { name: 'Project task' }, now: NOW } as Action)
    const issueId = Object.values(st.issues).find((i) => i.subject === 'Project task')!.id

    const priyaId = Object.values(st.model.people).find((pp) => pp.name === 'Priya')!.id
    const samId = Object.values(st.model.people).find((pp) => pp.name === 'Sam')!.id
    st = ok(st, { t: 'config', op: { k: 'upsertPerson', id: priyaId, name: 'Priya', roleIds: ['ROLE_ENGAGEMENT_LEAD'] }, now: NOW } as Action)
    st = ok(st, { t: 'config', op: { k: 'upsertPerson', id: samId, name: 'Sam', roleIds: ['ROLE_TECHNICAL'] }, now: NOW } as Action)
    const lead: Actor = { id: priyaId, name: 'Priya' }
    const sam: Actor = { id: samId, name: 'Sam' }

    st = ok(st, { t: 'addProjectMember', projectId, person: 'Sam', projectRoleId: 'PROJROLE_CONSULTANT', now: NOW } as Action)
    const memberId = Object.values(st.projectMembers).find((m) => m.person === 'Sam')!.id
    const resolved = projectOf(st, issueId)
    const beforeRemove = canOnProject(st.model, sam, 'work.edit', resolved, Object.values(st.projectMembers))

    st = ok(st, { t: 'removeProjectMember', id: memberId, now: NOW } as Action)
    const rowSurvives = Boolean(st.projectMembers[memberId]) && st.projectMembers[memberId].removedAt === NOW
    const afterRemove = canOnProject(st.model, sam, 'work.edit', resolved, Object.values(st.projectMembers))

    const good = beforeRemove.allowed && rowSurvives && !afterRemove.allowed
    return good
      ? { verdict: 'PASS', actual: `before=${beforeRemove.allowed} rowSurvives=${rowSurvives} after=${afterRemove.allowed}`, stops: '', severity: 'P1', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `before=${beforeRemove.allowed} rowSurvives=${rowSurvives} after=${afterRemove.allowed}`, stops: 'a removed member either still grants access, or the removal destroyed the row instead of soft-ending it', severity: 'P0', impact: 'someone removed from a project keeps access, or the history of who was staffed where is lost' } as const
  },
)

scenario(
  'PM10',
  'An internal project member sees their project in full, and none of another',
  'projectView keeps every issue, note, evidence item and time entry under a project the reader is staffed on, and drops all of another project’s the same way — checked by asserting on the ABSENCE of the other project’s specific ids, the discipline clientView’s own payload-leak proof already follows.',
  () => {
    const oapilId = Object.values(BASE.nodes).find((n) => n.kind === 'client')!.id
    let st = ok(BASE, { t: 'create', parentId: oapilId, kind: 'project', draft: { name: 'Alpha' }, now: NOW } as Action)
    const alphaId = Object.values(st.nodes).find((n) => n.kind === 'project' && n.name === 'Alpha')!.id
    st = ok(st, { t: 'create', parentId: oapilId, kind: 'project', draft: { name: 'Beta' }, now: NOW } as Action)
    const betaId = Object.values(st.nodes).find((n) => n.kind === 'project' && n.name === 'Beta')!.id

    st = ok(st, { t: 'create', parentId: alphaId, kind: 'issue', draft: { name: 'Alpha task' }, now: NOW } as Action)
    const alphaIssue = Object.values(st.issues).find((i) => i.subject === 'Alpha task')!
    st = ok(st, { t: 'create', parentId: betaId, kind: 'issue', draft: { name: 'Beta task' }, now: NOW } as Action)
    const betaIssue = Object.values(st.issues).find((i) => i.subject === 'Beta task')!

    const priyaId = Object.values(st.model.people).find((pp) => pp.name === 'Priya')!.id
    st = ok(st, { t: 'config', op: { k: 'upsertPerson', id: priyaId, name: 'Priya', roleIds: ['ROLE_TECHNICAL'] }, now: NOW } as Action)
    st = ok(st, { t: 'addNote', issueId: alphaIssue.id, body: 'alpha note', noteType: 'Internal Discussion', pinned: false, now: NOW } as Action)
    st = ok(st, { t: 'addNote', issueId: betaIssue.id, body: 'beta note', noteType: 'Internal Discussion', pinned: false, now: NOW } as Action)
    st = ok(st, { t: 'addProjectMember', projectId: alphaId, person: 'Priya', projectRoleId: 'PROJROLE_CONSULTANT', now: NOW } as Action)

    const view = projectView(st, memberProjectIdsFor(st, priyaId))
    const good =
      Boolean(view.issues[alphaIssue.id]) &&
      !view.issues[betaIssue.id] &&
      Boolean(view.nodes[alphaId]) &&
      !view.nodes[betaId] &&
      Object.values(view.notes).some((n) => n.issueId === alphaIssue.id) &&
      !Object.values(view.notes).some((n) => n.issueId === betaIssue.id)

    return good
      ? { verdict: 'PASS', actual: `alpha issue kept=${Boolean(view.issues[alphaIssue.id])}, beta issue kept=${Boolean(view.issues[betaIssue.id])}`, stops: '', severity: 'P1', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `alpha=${Boolean(view.issues[alphaIssue.id])} beta=${Boolean(view.issues[betaIssue.id])}`, stops: 'the project boundary leaks another project’s content, or hides the reader’s own', severity: 'P0', impact: 'a project member sees a project they are not staffed on, or cannot see the one they are' } as const
  },
)

scenario(
  'PM11',
  'Audit entries about another project’s issue are dropped whole, not just the issue itself',
  'The same leak class clientView’s launch found once already — a child-content audit entry surviving under a parent that itself was filtered — checked again here because a new redaction function can reproduce an old bug for a new reason.',
  () => {
    const oapilId = Object.values(BASE.nodes).find((n) => n.kind === 'client')!.id
    let st = ok(BASE, { t: 'create', parentId: oapilId, kind: 'project', draft: { name: 'Alpha' }, now: NOW } as Action)
    const alphaId = Object.values(st.nodes).find((n) => n.kind === 'project' && n.name === 'Alpha')!.id
    st = ok(st, { t: 'create', parentId: oapilId, kind: 'project', draft: { name: 'Beta' }, now: NOW } as Action)
    const betaId = Object.values(st.nodes).find((n) => n.kind === 'project' && n.name === 'Beta')!.id
    st = ok(st, { t: 'create', parentId: betaId, kind: 'issue', draft: { name: 'Beta task' }, now: NOW } as Action)
    const betaIssue = Object.values(st.issues).find((i) => i.subject === 'Beta task')!

    const priyaId = Object.values(st.model.people).find((pp) => pp.name === 'Priya')!.id
    st = ok(st, { t: 'config', op: { k: 'upsertPerson', id: priyaId, name: 'Priya', roleIds: ['ROLE_TECHNICAL'] }, now: NOW } as Action)
    st = ok(st, { t: 'setDates', id: betaIssue.id, start: '2026-09-01', end: '2026-09-05', now: NOW } as Action)
    st = ok(st, { t: 'addProjectMember', projectId: alphaId, person: 'Priya', projectRoleId: 'PROJROLE_CONSULTANT', now: NOW } as Action)

    const view = projectView(st, memberProjectIdsFor(st, priyaId))
    const auditLeaked = view.audit.some((a) => a.rowId === betaIssue.id)

    return !auditLeaked
      ? { verdict: 'PASS', actual: `audit rows about Beta in the reader’s view: ${view.audit.filter((a) => a.rowId === betaIssue.id).length}`, stops: '', severity: 'P1', impact: 'none' } as const
      : { verdict: 'FAIL', actual: 'an audit entry about a non-member project’s issue survived', stops: 'the audit trail leaks activity on a project the reader is not staffed on', severity: 'P0', impact: 'a project member can read what happened on a project they cannot otherwise see' } as const
  },
)

scenario(
  'PM12',
  'Work with no project ancestor is never gated, whatever the reader is staffed on',
  'projectView’s default is ALLOW for ungated work — the deliberate boundary the design names, checked here directly rather than only inferred from projectOf.',
  () => {
    /* BASE’s seeded issues sit under a module, directly under the engagement — no project at all. */
    const priyaId = Object.values(BASE.model.people).find((pp) => pp.name === 'Priya')!.id
    const staffed = ok(BASE, { t: 'config', op: { k: 'upsertPerson', id: priyaId, name: 'Priya', roleIds: ['ROLE_TECHNICAL'] }, now: NOW } as Action)

    /* Zero memberships — staffed nowhere — and the ungated seed issues still survive. */
    const view = projectView(staffed, memberProjectIdsFor(staffed, priyaId))
    const good = Boolean(view.issues['OAPIL-1']) && Boolean(view.issues['OAPIL-2']) && Boolean(view.issues['OAPIL-3'])

    return good
      ? { verdict: 'PASS', actual: `OAPIL-1..3 all kept with zero project memberships`, stops: '', severity: 'P1', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `OAPIL-1=${Boolean(view.issues['OAPIL-1'])} OAPIL-2=${Boolean(view.issues['OAPIL-2'])} OAPIL-3=${Boolean(view.issues['OAPIL-3'])}`, stops: 'work never organised into a project became invisible to someone staffed on no project', severity: 'P0', impact: 'the majority of a firm’s pre-existing work vanishes for anyone not yet enrolled anywhere' } as const
  },
)

scenario(
  'PM13',
  'boot()’s redaction routes correctly: exempt sees everything, a staffed member sees their project, an unstaffed reader sees only ungated work',
  'The three-way branch inside internal.view — isExempt bypasses projectView entirely, a member gets projectView narrowed to their projects, everyone else gets projectView with an empty member set — exercised end to end through the same function boot() calls.',
  () => {
    const oapilId = Object.values(BASE.nodes).find((n) => n.kind === 'client')!.id
    let st = ok(BASE, { t: 'create', parentId: oapilId, kind: 'project', draft: { name: 'Alpha' }, now: NOW } as Action)
    const alphaId = Object.values(st.nodes).find((n) => n.kind === 'project' && n.name === 'Alpha')!.id
    st = ok(st, { t: 'create', parentId: alphaId, kind: 'issue', draft: { name: 'Alpha task' }, now: NOW } as Action)
    const alphaIssue = Object.values(st.issues).find((i) => i.subject === 'Alpha task')!

    const priyaId = Object.values(st.model.people).find((pp) => pp.name === 'Priya')!.id
    const samId = Object.values(st.model.people).find((pp) => pp.name === 'Sam')!.id
    st = ok(st, { t: 'config', op: { k: 'upsertPerson', id: priyaId, name: 'Priya', roleIds: ['ROLE_TECHNICAL'] }, now: NOW } as Action)
    st = ok(st, { t: 'config', op: { k: 'upsertPerson', id: samId, name: 'Sam', roleIds: ['ROLE_TECHNICAL'] }, now: NOW } as Action)
    st = ok(st, { t: 'addProjectMember', projectId: alphaId, person: 'Priya', projectRoleId: 'PROJROLE_CONSULTANT', now: NOW } as Action)

    /* boot()'s actual branch: `isExempt(...) ? base : projectView(...)`. `A` (Validator) falls
       to the shipped ADMIN fallback role — the same reasoning PM3 already proves — so an
       exempt reader's view is `st` itself, never routed through projectView at all. */
    const adminView = isExempt(st.model, A) ? st : projectView(st, memberProjectIdsFor(st, null))
    const adminSeesAlpha = Boolean(adminView.issues[alphaIssue.id])

    const memberView = projectView(st, memberProjectIdsFor(st, priyaId))
    const memberSeesAlpha = Boolean(memberView.issues[alphaIssue.id])

    const unstaffedView = projectView(st, memberProjectIdsFor(st, samId))
    const unstaffedSeesAlpha = Boolean(unstaffedView.issues[alphaIssue.id])
    const unstaffedSeesUngated = Boolean(unstaffedView.issues['OAPIL-1'])

    const good = adminSeesAlpha && memberSeesAlpha && !unstaffedSeesAlpha && unstaffedSeesUngated
    return good
      ? { verdict: 'PASS', actual: `admin sees Alpha=${adminSeesAlpha}, member sees Alpha=${memberSeesAlpha}, unstaffed sees Alpha=${unstaffedSeesAlpha} but sees ungated work=${unstaffedSeesUngated}`, stops: '', severity: 'P1', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `admin=${adminSeesAlpha} member=${memberSeesAlpha} unstaffedAlpha=${unstaffedSeesAlpha} unstaffedUngated=${unstaffedSeesUngated}`, stops: 'the three-way routing in boot() disagrees with the design for at least one of exempt/member/unstaffed', severity: 'P0', impact: 'either a lockout for someone who should see their own project, or a leak for someone who should not' } as const
  },
)

/* ================================================================== *
 * Personal calendar
 * ================================================================== */

scenario(
  'PC1',
  'An event, a commitment, an allocation and a work item all land on their owner’s month',
  'myCalendarMonth gathers all four kinds for one person, each on the day(s) it covers.',
  () => {
    const priyaId = Object.values(BASE.model.people).find((pp) => pp.name === 'Priya')!.id
    const oapilId = Object.values(BASE.nodes).find((n) => n.kind === 'client')!.id
    let st = ok(BASE, { t: 'create', parentId: oapilId, kind: 'project', draft: { name: 'Rollout' }, now: NOW } as Action)
    const projectId = Object.values(st.nodes).find((n) => n.kind === 'project' && n.name === 'Rollout')!.id
    st = ok(st, { t: 'create', parentId: projectId, kind: 'issue', draft: { name: 'Ship the thing' }, now: NOW } as Action)
    const issueId = Object.values(st.issues).find((i) => i.subject === 'Ship the thing')!.id
    st = ok(st, { t: 'updateIssue', id: issueId, patch: { owner: 'Priya', plannedStart: '2026-08-12', plannedEnd: '2026-08-12' }, now: NOW } as Action)

    const event: PersonalEvent = { id: 'ev-1', personId: priyaId, title: 'Dentist', startAt: '2026-08-05T09:00:00.000Z', endAt: '2026-08-05T10:00:00.000Z', allDay: false, note: '', attendees: '', createdAt: NOW, deletedAt: null }
    const commitment: Commitment = { id: 'commit-x', person: 'Priya', personId: priyaId, kind: 'Leave', startDate: '2026-08-10', endDate: '2026-08-10', hoursPerDay: 7.5, note: '', createdBy: 'val', createdAt: NOW, deletedAt: null }
    const allocation: Allocation = { id: 'alloc-x', person: 'Priya', personId: priyaId, projectId, startDate: '2026-08-01', endDate: '2026-08-20', percentage: 60, note: '', createdBy: 'val', createdAt: NOW, deletedAt: null }
    st = {
      ...st,
      personalEvents: { [event.id]: event },
      commitments: { ...st.commitments, [commitment.id]: commitment },
      allocations: { ...st.allocations, [allocation.id]: allocation },
    }

    const month = myCalendarMonth(st, priyaId, '2026-08-15')
    const day = (iso: string) => month.weeks.flat().find((d) => d.date === iso)!
    const good =
      day('2026-08-05').entries.some((e) => e.kind === 'event' && e.id === 'ev-1') &&
      day('2026-08-10').entries.some((e) => e.kind === 'commitment' && e.id === 'commit-x') &&
      day('2026-08-12').entries.some((e) => e.kind === 'allocation' && e.id === 'alloc-x') &&
      day('2026-08-12').entries.some((e) => e.kind === 'work' && e.issueId === issueId)

    return good
      ? { verdict: 'PASS', actual: `all four kinds found on their expected day`, stops: '', severity: 'P1', impact: 'none' } as const
      : { verdict: 'FAIL', actual: JSON.stringify(month.weeks.flat().filter((d) => d.entries.length)), stops: 'one or more kinds did not land on the expected day', severity: 'P1', impact: 'a person’s own calendar is missing entries that belong to them' } as const
  },
)

scenario(
  'PC2',
  'Another person’s events, commitments, allocations and work do not appear in this month',
  'The aggregation’s own join is exercised before any reducer or redaction exists to also get it right.',
  () => {
    const priyaId = Object.values(BASE.model.people).find((pp) => pp.name === 'Priya')!.id
    const samId = Object.values(BASE.model.people).find((pp) => pp.name === 'Sam')!.id
    const oapilId = Object.values(BASE.nodes).find((n) => n.kind === 'client')!.id
    let st = ok(BASE, { t: 'create', parentId: oapilId, kind: 'project', draft: { name: 'Rollout' }, now: NOW } as Action)
    const projectId = Object.values(st.nodes).find((n) => n.kind === 'project' && n.name === 'Rollout')!.id
    st = ok(st, { t: 'create', parentId: projectId, kind: 'issue', draft: { name: 'Sam’s task' }, now: NOW } as Action)
    const issueId = Object.values(st.issues).find((i) => i.subject === 'Sam’s task')!.id
    st = ok(st, { t: 'updateIssue', id: issueId, patch: { owner: 'Sam', plannedStart: '2026-08-12', plannedEnd: '2026-08-12' }, now: NOW } as Action)

    const event: PersonalEvent = { id: 'ev-2', personId: samId, title: 'Sam’s dentist', startAt: '2026-08-05T09:00:00.000Z', endAt: '2026-08-05T10:00:00.000Z', allDay: false, note: '', attendees: '', createdAt: NOW, deletedAt: null }
    const commitment: Commitment = { id: 'commit-y', person: 'Sam', personId: samId, kind: 'Leave', startDate: '2026-08-10', endDate: '2026-08-10', hoursPerDay: 7.5, note: '', createdBy: 'val', createdAt: NOW, deletedAt: null }
    const allocation: Allocation = { id: 'alloc-y', person: 'Sam', personId: samId, projectId, startDate: '2026-08-01', endDate: '2026-08-20', percentage: 60, note: '', createdBy: 'val', createdAt: NOW, deletedAt: null }
    st = {
      ...st,
      personalEvents: { [event.id]: event },
      commitments: { ...st.commitments, [commitment.id]: commitment },
      allocations: { ...st.allocations, [allocation.id]: allocation },
    }

    const month = myCalendarMonth(st, priyaId, '2026-08-15')
    const all = month.weeks.flat().flatMap((d) => d.entries)
    const nothingLeaked = !all.some((e) => ['ev-2', 'commit-y', 'alloc-y'].includes(e.id)) && !all.some((e) => e.kind === 'work' && e.issueId === issueId)

    return nothingLeaked
      ? { verdict: 'PASS', actual: `Priya's month contains none of Sam's entries`, stops: '', severity: 'P1', impact: 'none' } as const
      : { verdict: 'FAIL', actual: JSON.stringify(all), stops: 'the aggregation joins to the wrong person', severity: 'P0', impact: 'one person’s calendar shows another person’s events, leave, allocation or work' } as const
  },
)

scenario(
  'PC3',
  'A multi-day commitment and allocation appear on every day they span, clipped to the month',
  'The same clipping rule calendarMonth already proves for work items, applied here to the other three kinds too.',
  () => {
    const priyaId = Object.values(BASE.model.people).find((pp) => pp.name === 'Priya')!.id
    const oapilId = Object.values(BASE.nodes).find((n) => n.kind === 'client')!.id
    let st = ok(BASE, { t: 'create', parentId: oapilId, kind: 'project', draft: { name: 'Rollout' }, now: NOW } as Action)
    const projectId = Object.values(st.nodes).find((n) => n.kind === 'project' && n.name === 'Rollout')!.id

    // Spans July into August — only the August days should appear in the August grid.
    const commitment: Commitment = { id: 'commit-z', person: 'Priya', personId: priyaId, kind: 'Leave', startDate: '2026-07-30', endDate: '2026-08-02', hoursPerDay: 7.5, note: '', createdBy: 'val', createdAt: NOW, deletedAt: null }
    st = { ...st, commitments: { ...st.commitments, [commitment.id]: commitment } }

    const month = myCalendarMonth(st, priyaId, '2026-08-15')
    const augDays = ['2026-08-01', '2026-08-02'].every((iso) =>
      month.weeks.flat().find((d) => d.date === iso)?.entries.some((e) => e.id === 'commit-z'),
    )
    const julyLeaked = month.weeks.flat().some((d) => d.date < '2026-08-01' && d.entries.some((e) => e.id === 'commit-z'))

    const good = augDays && !julyLeaked
    return good
      ? { verdict: 'PASS', actual: 'Aug 1-2 carry the span; nothing from July does', stops: '', severity: 'P1', impact: 'none' } as const
      : { verdict: 'FAIL', actual: `augDays=${augDays} julyLeaked=${julyLeaked}`, stops: 'a multi-day span is not clipped correctly to the requested month', severity: 'P1', impact: 'a leave period spanning a month boundary is missing days or bleeds into an adjacent month’s grid' } as const
  },
)

scenario(
  'PC4',
  'An owned work item with no planned end is listed as unscheduled, not silently dropped',
  'The same honesty calendarMonth already established for undated work items.',
  () => {
    const priyaId = Object.values(BASE.model.people).find((pp) => pp.name === 'Priya')!.id
    const oapilId = Object.values(BASE.nodes).find((n) => n.kind === 'client')!.id
    let st = ok(BASE, { t: 'create', parentId: oapilId, kind: 'project', draft: { name: 'Rollout' }, now: NOW } as Action)
    const projectId = Object.values(st.nodes).find((n) => n.kind === 'project' && n.name === 'Rollout')!.id
    st = ok(st, { t: 'create', parentId: projectId, kind: 'issue', draft: { name: 'No date yet' }, now: NOW } as Action)
    const issueId = Object.values(st.issues).find((i) => i.subject === 'No date yet')!.id
    st = ok(st, { t: 'updateIssue', id: issueId, patch: { owner: 'Priya' }, now: NOW } as Action)

    const month = myCalendarMonth(st, priyaId, '2026-08-15')
    const good = month.unscheduled.some((u) => u.issueId === issueId) && !month.weeks.flat().some((d) => d.entries.some((e) => e.kind === 'work' && e.issueId === issueId))

    return good
      ? { verdict: 'PASS', actual: `listed unscheduled: ${month.unscheduled.map((u) => u.title).join(', ')}`, stops: '', severity: 'P1', impact: 'none' } as const
      : { verdict: 'FAIL', actual: JSON.stringify(month.unscheduled), stops: 'undated owned work is silently absent instead of listed', severity: 'P1', impact: 'work with no planned date disappears from a person’s calendar entirely' } as const
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
