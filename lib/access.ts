import { isMachineActor, type Actor } from './actor'
import type { OperatingModel, Person } from './config'

/**
 * What each role may do, and the check every mutation passes through.
 *
 * ---------------------------------------------------------------------------
 * Authentication and authorisation are different problems, and only one is solved here
 *
 * This module answers "may *this* actor do *that*". It does not answer "is this actor who
 * they claim to be" — there is still no login, no session and no identity provider, and
 * `currentActor()` reads one configured operator from the environment. Anyone who can reach
 * the server is that operator.
 *
 * Both halves used to be missing, and while they were, a permission model would have been
 * theatre: rules deciding what an unverified party may do, reading as a security boundary in
 * every screen while enforcing nothing. That was the reasoning for shipping a seam that
 * returned ALLOWED, and it was right at the time.
 *
 * It stops being right once the rules themselves are the thing being got wrong. A firm cannot
 * state that a client user may raise work but not close it, that an analyst may triage but not
 * agree an estimate, or that only an administrator may change the operating model — and
 * validation could not test any of it, because there was nothing to test. So the authorisation
 * half is built now, enforced in the reducer rather than in the screens, and configurable.
 * When authentication arrives, `currentActor` starts returning a verified principal and
 * nothing below this line changes.
 *
 * **Be exact about what this is worth today.** It stops a mistake, not an attacker. Until
 * there is a login, a determined party sets an environment variable and becomes whoever they
 * like. `defaultRoleIds` is where that honesty is concentrated: an actor nobody has assigned a
 * role to falls back to it, and it ships as Administrator, because a deployment with one
 * configured operator and no login must still be usable by that operator. On the day a login
 * exists, that field should become empty and every real person should carry real roles.
 */

/* ================================================================== *
 * The vocabulary
 * ================================================================== */

/**
 * Every distinct thing a person can be permitted to do.
 *
 * Closed on purpose, and deliberately coarse. A per-field or per-scope grant would let a firm
 * express far more, and would also let them express nonsense — and every extra dimension is a
 * dimension the reducer has to check correctly on every path. These are the distinctions
 * delivery work actually argues about: who may close, who may commit a date, who may change
 * the firm's own operating model.
 */
export const PERMISSIONS = [
  { key: 'work.create', label: 'Raise work', what: 'Create an issue, task or any other work item.' },
  { key: 'work.edit', label: 'Edit work', what: 'Change the fields of a work item, short of closing it.' },
  { key: 'work.assign', label: 'Assign work', what: 'Set the owner, the accountable party and any other responsibility.' },
  { key: 'work.close', label: 'Close work', what: 'Move a work item into a closing status.' },
  { key: 'mail.send', label: 'Write to clients', what: 'Send email from an engagement’s own mailbox, recorded on the record. Clients receive it, which is why it is its own authority.' },
  { key: 'work.schedule', label: 'Commit dates', what: 'Set or move a planned start and end. A date is a commitment.' },
  { key: 'work.link', label: 'Relate work', what: 'Link two records, or declare a dependency between them.' },
  { key: 'work.move', label: 'Move work', what: 'Reparent a record, or create and rename the tiers it sits in.' },
  { key: 'work.archive', label: 'Archive', what: 'Withdraw a record from the tree. Reversible, and audited.' },
  { key: 'work.restore', label: 'Restore', what: 'Bring an archived record back.' },
  { key: 'note.add', label: 'Add notes', what: 'Record what happened on an issue.' },
  { key: 'note.editAny', label: 'Edit any note', what: "Correct somebody else's note. Editing your own never needs this." },
  { key: 'evidence.add', label: 'Attach evidence', what: 'Attach a document, link or snapshot to a record.' },
  { key: 'evidence.remove', label: 'Remove evidence', what: 'Withdraw an attachment. Imported evidence can never be removed.' },
  { key: 'time.record', label: 'Record time', what: 'Log hours against work. Your own time — see the next one for anybody else\u2019s.' },
  { key: 'time.recordForOthers', label: "Record others' time", what: "Log or correct hours on somebody else's behalf." },
  { key: 'time.submit', label: 'Submit a timesheet', what: 'Present your own week for approval. Covers your weeks only — the reducer compares the actor to the person on the sheet, so holding this is not enough to submit somebody else’s.' },
  {
    key: 'rate.view',
    label: 'See rates',
    what: 'What people cost and what they are charged out at, and every figure derived from those \u2014 cost, revenue and margin. Withheld from the page payload entirely for anybody without it, not merely hidden on screen.',
  },
  {
    key: 'rate.edit',
    label: 'Set rates',
    what: 'Record or correct a cost or charge-out rate, from a date, with a reason.',
  },
  { key: 'time.approve', label: 'Decide a timesheet', what: 'Approve a submitted week, or return it with a reason. Never your own: the person who submitted may not decide it, whatever they hold.' },
  /*
   * Two keys, split on the axis that matters commercially. Recording a payment schedule and
   * saying the work has landed are both delivery acts and share `milestone.edit`. Saying the
   * work is ACCEPTABLE is the client's judgement, and it is what makes money owed — so it is its
   * own grant, held by the client sponsor and the engagement leader, and the reducer refuses it
   * to whoever recorded the delivery whatever they hold.
   */
  /*
   * Recording what a contract says and agreeing that it IS the scope are different acts, so they
   * are different grants — the same split as planning a milestone and accepting one.
   *
   * The "asker cannot be the decider" rule is deliberately NOT applied to scope approval, unlike
   * change requests and milestones. Transcribing a signed statement of work is not proposing
   * something, and the other producer of scope lines is an extraction with no grant at all. A
   * firm that wants segregation here can withhold `scope.approve`, which is the lever that
   * actually expresses it.
   */
  { key: 'scope.edit', label: 'Record scope', what: 'Write down what a statement of work says it will deliver — deliverables, acceptance criteria, assumptions, exclusions.' },
  { key: 'scope.approve', label: 'Agree scope', what: 'Confirm that a recorded line is part of the agreed scope. Until it is agreed it is a note, and its hours are left out of the scope total.' },
  { key: 'milestone.edit', label: 'Plan a milestone', what: 'Set out the payment schedule against a statement of work, and record when a milestone is delivered.' },
  { key: 'milestone.accept', label: 'Accept a milestone', what: 'Sign a milestone off, or return it with a reason. Never one you recorded as delivered yourself — acceptance is somebody else’s judgement, and it is what makes a milestone billable.' },
  /*
   * Two keys, not three. There is deliberately no `document.view`.
   *
   * Attaching a file and withdrawing one are acts; reading what is attached to a record you can
   * already see is not, and `evidence.add` / `evidence.remove` have had exactly this shape since
   * the beginning with no view grant beside them. A document behind a grant that its own
   * evidence row is not behind would be a confidentiality boundary drawn through the middle of
   * one attachment.
   *
   * What downloads DO require is a verified session — `GET /api/documents/[id]` refuses an
   * anonymous request, and that is the control that matters. Per-record confidentiality is a
   * different feature (row-level security, which the audit lists as an open decision) and
   * pretending a permission key here delivers it would be worse than not having one.
   */
  { key: 'document.upload', label: 'Attach a file', what: 'Upload a document against an issue, a statement of work, a project or a change. The file is stored, not just described.' },
  { key: 'document.remove', label: "Withdraw somebody else's file", what: 'Withdraw a file another person attached. Your own can always be withdrawn by you.' },
  /*
   * Three keys rather than one, on the same split as `time.record` / `time.recordForOthers`.
   *
   * A skills directory that only a lead can fill in stays empty, so recording your own is part
   * of doing the work. Saying how good somebody ELSE is, or attaching the word "assessed" to a
   * level, is a judgement about a colleague and takes its own grant. Reading other people's
   * levels is a third thing again — see the boundary note in `lib/skills.ts`.
   */
  { key: 'skill.record', label: 'Record your own skills', what: 'Say what you can do and at what level. Your own only, and self-rated — see the next two.' },
  { key: 'skill.assess', label: "Assess somebody's skill", what: "Record a level against another person, or mark any level as assessed or certified rather than self-rated." },
  {
    key: 'skill.view',
    label: 'See skill levels',
    what: 'How good somebody is said to be, who said so, and any note. Without it the directory still shows WHO holds a skill and when they last used it — the levels are removed from the page payload, not merely hidden, and your own are never withheld from you.',
  },
  { key: 'approval.request', label: 'Ask for approval', what: 'Raise an approval against a record so it can proceed.' },
  { key: 'approval.decide', label: 'Decide an approval', what: 'Approve or reject. The rule also names which roles may — both are required.' },
  { key: 'document.review', label: 'Review deliverables', what: 'Answer approve or request changes on a document sent to you. The review names its reviewers — both are required.' },
  { key: 'estimate.edit', label: 'Estimate', what: 'Score complexity, set capacity and build a breakdown.' },
  { key: 'estimate.agree', label: 'Agree an estimate', what: 'Baseline it, after which changes need a reason.' },
  { key: 'lifecycle.build', label: 'Plan a lifecycle', what: 'Generate or clear the activity plan under an issue.' },
  { key: 'capacity.allocate', label: 'Commit somebody', what: "Allocate a person to a project — a claim on time that is not yours." },
  { key: 'capacity.record', label: 'Record time off', what: 'Leave, holidays and internal commitments that come off available capacity.' },
  { key: 'sow.edit', label: 'Record a statement of work', what: 'Create or change a SOW and its agreed effort and value.' },
  {
    key: 'change.approve',
    label: 'Decide a change request',
    what: 'Approve or refuse a variation to a statement of work. Never your own \u2014 the person who raised it may not decide it, whatever they hold. Raising one is `sow.edit`.',
  },
  { key: 'sow.attribute', label: 'Attribute work to a SOW', what: 'Say which statement of work a project is delivered under.' },
  { key: 'engagement.edit', label: 'Edit engagement detail', what: 'Commercial and governance detail on an engagement.' },
  { key: 'config.manage', label: 'Configure the platform', what: 'Terminology, roles, work types, service levels, transitions, agents, templates and routing.' },
] as const

export type PermissionKey = (typeof PERMISSIONS)[number]['key']

export const PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key)

/* ================================================================== *
 * The policy
 * ================================================================== */

export interface AccessPolicy {
  /**
   * Whether grants are applied.
   *
   * Defaults to true, for the reason the transition graph does: a permission table that
   * changes nothing is worse than none, because it reads as a control in every review.
   */
  enforced: boolean
  /** Role id → what that role may do. A role absent from this map may do nothing. */
  grants: Record<string, PermissionKey[]>
  /**
   * Roles applied to an actor with none of their own.
   *
   * Covers two states that are really one — an actor the directory does not recognise, and a
   * person in the directory nobody has assigned a role to. Both mean "nothing has been said
   * about this person", and the imported directory is entirely the second: the client log
   * records who worked an issue and never records what they are.
   */
  defaultRoleIds: string[]
  /** Roles held by the intake endpoint and the scheduled pass. See `MACHINE_ROLE_ID`. */
  machineRoleIds: string[]
}

/** Administrator is a platform role, not a delivery one, which is why it is not in the seeded nine. */
export const ADMIN_ROLE_ID = 'ROLE_ADMIN'

/**
 * What the intake endpoint and the scheduled pass may do.
 *
 * Separate from every human role, and deliberately narrow: a machine that inherits
 * Administrator because nobody assigned it anything is how an automated path ends up able to
 * change the operating model. These two file work and say things about it. They cannot close
 * anything, commit a date, agree an estimate or touch configuration.
 */
export const MACHINE_ROLE_ID = 'ROLE_AUTOMATION'

const ALL: PermissionKey[] = [...PERMISSION_KEYS]

const DELIVERY_CORE: PermissionKey[] = [
  'work.create', 'work.edit', 'work.assign', 'work.close', 'work.schedule', 'work.link', 'mail.send',
  'note.add', 'evidence.add', 'estimate.edit', 'lifecycle.build', 'time.record', 'approval.request',
  // Beside `evidence.add`, because attaching the file and describing it are one act to the
  // person doing it. Anybody who may say "here is the proof" may hold up the proof.
  'document.upload',
  // Submitting is part of doing the work: anybody who records time has a week to attest to.
  // Approving is not here — it is added to the two roles below that already decide things.
  'time.submit',
  // Same argument: a skills directory nobody but a lead may write to is a directory that stays
  // empty. This covers your own, self-rated. Assessing anybody else is a separate grant.
  'skill.record',
]

/**
 * The shipped map.
 *
 * A starting point, in the same sense the T-shirt calibration is: two firms running identical
 * role names will disagree about who may agree an estimate. What matters is that the argument
 * now happens in configuration instead of being settled silently by the absence of a check.
 *
 * The client-side roles are the ones worth reading closely. They may raise work, say things
 * about it and attach evidence — and they may not close it, schedule it, or estimate it.
 * A client confirming a resolution is a status *the firm* moves the record into on their word;
 * letting the client move it themselves would make Closed - confirmed unfalsifiable.
 */
export const DEFAULT_GRANTS: Record<string, PermissionKey[]> = {
  [ADMIN_ROLE_ID]: ALL,
  /*
   * `estimate.edit` is here and `estimate.agree` deliberately is not, and that pair is the whole
   * control on what an agent may do to an estimate.
   *
   * The comment on MACHINE_ROLE_ID says a machine cannot "agree an estimate". It still cannot:
   * agreeing is baselining, `estimate.agree` gates it, and nothing automated holds it. What the
   * estimation agent does is *propose* — write complexity scores and the reasoning behind them
   * into an estimate nobody has committed to — which is exactly what `maxAutonomy: 'propose'`
   * means everywhere else in the registry, and what the whole agent architecture is built to do.
   *
   * Granting it was a deliberate widening rather than a fix for an inconvenient refusal. Without
   * it the agent cannot write anything, and an estimation agent that cannot record an estimate
   * is the "declared, with no runtime" pattern this codebase keeps deleting.
   */
  [MACHINE_ROLE_ID]: ['work.create', 'work.edit', 'work.assign', 'note.add', 'evidence.add', 'approval.request', 'estimate.edit'],
  /*
   * Rates go to the engagement lead and the administrator, and to nobody else by default \u2014 not
   * even the project manager, who otherwise has the wider delivery grant. What somebody is paid
   * is not delivery information, and a role that needs it in a particular firm can be given it
   * deliberately.
   */
  ROLE_ENGAGEMENT_LEAD: [...DELIVERY_CORE, 'approval.decide', 'document.review', 'time.approve', 'rate.view', 'rate.edit', 'change.approve', 'skill.assess', 'skill.view', 'milestone.edit', 'milestone.accept', 'scope.edit', 'scope.approve', 'time.recordForOthers', 'work.move', 'work.archive', 'work.restore', 'estimate.agree', 'engagement.edit', 'sow.edit', 'sow.attribute', 'capacity.allocate', 'capacity.record', 'note.editAny', 'evidence.remove', 'document.remove', 'config.manage'],
  /*
   * A principal assesses but does not staff, so they read levels and record them and get none of
   * the commercial grants. This is the role the word "assessed" is really for: a senior person
   * putting their name to a judgement about somebody they have worked with.
   */
  ROLE_PRINCIPAL: [...DELIVERY_CORE, 'estimate.agree', 'work.move', 'skill.assess', 'skill.view'],
  ROLE_PROJECT_MANAGER: [...DELIVERY_CORE, 'approval.decide', 'document.review', 'time.approve', 'work.move', 'work.archive', 'work.restore', 'estimate.agree', 'engagement.edit', 'sow.attribute', 'time.recordForOthers', 'capacity.allocate', 'capacity.record', 'skill.assess', 'skill.view', 'milestone.edit', 'scope.edit'],
  ROLE_FUNCTIONAL: [...DELIVERY_CORE],
  ROLE_TECHNICAL: [...DELIVERY_CORE],
  // Named explicitly rather than taking DELIVERY_CORE, so `skill.record` has to be added here
  // too. A support consultant has skills like anybody else, and a directory that cannot hear
  // from a whole role is a directory with a hole in it nobody would think to look for.
  ROLE_SUPPORT: ['work.create', 'work.edit', 'work.assign', 'note.add', 'evidence.add', 'time.record', 'time.submit', 'skill.record', 'document.upload'],
  // The one client role that decides anything: a sponsor is the person a change order is
  // actually put to, and a rule that names them is worthless if the grant does not.
  // The one client role that decides anything, and milestone acceptance is the decision that
  // most belongs to a client: it is what turns delivered work into money owed.
  ROLE_CLIENT_SPONSOR: ['work.create', 'note.add', 'evidence.add', 'approval.decide', 'document.review', 'milestone.accept'],
  ROLE_CLIENT_LEAD: ['work.create', 'note.add', 'evidence.add'],
  ROLE_CLIENT_USER: ['work.create', 'note.add'],
}

export function defaultAccessPolicy(): AccessPolicy {
  return {
    enforced: true,
    grants: Object.fromEntries(Object.entries(DEFAULT_GRANTS).map(([k, v]) => [k, [...v]])),
    // See the module comment. This is the line that should empty on the day a login exists.
    defaultRoleIds: [ADMIN_ROLE_ID],
    machineRoleIds: [MACHINE_ROLE_ID],
  }
}

/* ================================================================== *
 * Resolution
 * ================================================================== */

/**
 * The roles this actor holds.
 *
 * Matched on the directory key first and the display name second, because the directory is
 * built from names discovered in an imported log and the configured operator is not
 * necessarily one of them. Falling back to the name is not sloppiness — it is the only join
 * available until a person has a real key, and it is exactly the weakness that authentication
 * removes.
 */
export function rolesFor(model: OperatingModel, actor: Actor): string[] {
  // Checked before the directory: a machine is not a person, and falling through to the
  // fallback role would hand it whatever an unrecognised human gets.
  if (isMachineActor(actor)) return model.access.machineRoleIds ?? []

  const person = directoryPersonFor(model, actor)
  const own = (person?.roleIds ?? []).filter((r) => model.roles?.[r] && !model.roles[r].deletedAt)
  return own.length ? own : model.access.defaultRoleIds
}

/**
 * The directory entry this actor is, or undefined.
 *
 * Extracted from `rolesFor`, which is where this join was written and where it must stay
 * identical to. Two places asking "which person is this?" and answering differently is how an
 * actor ends up holding a role they cannot see the consequences of — and there are now two
 * places asking: permissions, and whether a skill row is your own and so never withheld.
 *
 * Returns undefined for a machine actor. A machine is not a person, and giving it somebody's
 * directory entry because a name happened to match would hand it that person's private rows.
 */
export function directoryPersonFor(model: OperatingModel, actor: Actor): Person | undefined {
  if (isMachineActor(actor)) return undefined
  const people = Object.values(model.people ?? {})
  // Directory key first, then the address a provider supplied, then the display name. The
  // order is strongest-join-first: an object id is stable, an address is unique but changeable,
  // and a name is neither.
  //
  // The middle one was comparing an address against `actor.id`, which holds the provider's
  // object id — a GUID that never equals an email. So the join every Entra sign-in was meant
  // to use was dead, and everybody landed on the fallback role, which ships as Administrator.
  // Nothing failed; the wrong thing quietly worked.
  const claimed = actor.email?.trim().toLowerCase()
  return (
    people.find((p) => p.id === actor.id) ??
    (claimed ? people.find((p) => p.email?.toLowerCase() === claimed) : undefined) ??
    people.find((p) => p.name.toLowerCase() === actor.name.toLowerCase())
  )
}

export interface Decision {
  allowed: boolean
  /** Shown when denied, so a disabled control explains itself rather than just being grey. */
  reason?: string
}

const YES: Decision = { allowed: true }

/** What this actor may do, resolved once so a screen can ask many questions cheaply. */
export function permissionsFor(model: OperatingModel, actor: Actor): Set<PermissionKey> {
  const out = new Set<PermissionKey>()
  for (const roleId of rolesFor(model, actor)) {
    for (const key of model.access.grants[roleId] ?? []) out.add(key)
  }
  return out
}

export function can(model: OperatingModel, actor: Actor, key: PermissionKey): Decision {
  if (!model.access?.enforced) return YES
  if (permissionsFor(model, actor).has(key)) return YES

  const roleIds = rolesFor(model, actor)
  const named = roleIds.map((r) => model.roles?.[r]?.label ?? r).filter(Boolean)
  const what = PERMISSIONS.find((p) => p.key === key)?.label ?? key
  return {
    allowed: false,
    reason: named.length
      ? `${what} is not something ${named.join(' or ')} can do here.`
      : `${what} needs a role, and none has been assigned to ${actor.name}.`,
  }
}

/* ================================================================== *
 * The action map
 * ================================================================== */

/**
 * Which permission an action needs.
 *
 * One table rather than a check inside each of the reducer's arms. Twenty-odd scattered checks
 * is twenty-odd chances to forget one, and a forgotten check is invisible: the action keeps
 * working and nobody notices it was never guarded.
 *
 * This comment used to claim that an action added without a permission was "a compile-time hole
 * in a `Record`". It was not, and the claim was the dangerous part — it read as a guarantee and
 * stopped anybody checking. The map is keyed by `string`, so a missing action resolved to
 * `null` and `apply` skipped the permission check entirely. `recordVersion` and
 * `correctVersion` shipped that way: anyone who could reach the endpoint could rewrite a
 * person's working-pattern history, and nothing anywhere would have said so.
 *
 * The key cannot be narrowed here, because `Action` lives in `workspace.ts` and `workspace.ts`
 * imports this module — narrowing it would be a cycle. The assertion is made from the other
 * side instead: `workspace.ts` carries
 *
 *     ACTION_PERMISSIONS satisfies Record<Action['t'], PermissionKey | null>
 *
 * which is where both types are visible. Adding an action without a line here now fails the
 * build, which is what this paragraph originally promised.
 *
 * An action that genuinely needs no permission says so with `null` and a reason. Omission is
 * not a way of saying anything.
 */
export const ACTION_PERMISSIONS: Record<string, PermissionKey | null> = {
  create: 'work.create',
  // Duplicating mints an issue *and* a relationship, and this table has room for one key. The
  // second grant — `work.link` — is asked for in the arm itself, because the relationship is not
  // optional there. Omitting this line would not have failed the build: the map is keyed by
  // `string`, so a missing action resolves to `null` and the funnel skips the check entirely.
  duplicate: 'work.create',
  updateNode: 'work.edit',
  updateIssue: 'work.edit',
  updateActivity: 'work.edit',
  setDates: 'work.schedule',
  setAssignment: 'work.assign',
  move: 'work.move',
  link: 'work.link',
  unlink: 'work.link',
  addDependency: 'work.link',
  removeDependency: 'work.link',
  softDelete: 'work.archive',
  restore: 'work.restore',
  addEvidence: 'evidence.add',
  updateEvidence: 'evidence.add',
  removeEvidence: 'evidence.remove',
  addNote: 'note.add',
  // Editing and deleting a note are governed by authorship first — see `canEditNote`. The
  // grant here is the supervisor override, checked only when the actor is not the author.
  updateNote: null,
  removeNote: null,
  // Recording time for somebody else is a second question, asked in the arm where the
  // person on the entry is known.
  requestApproval: 'approval.request',
  decideApproval: 'approval.decide',
  addTime: 'time.record',
  updateTime: 'time.record',
  removeTime: 'time.record',
  setEstimate: 'estimate.edit',
  baselineEstimate: 'estimate.agree',
  buildLifecycle: 'lifecycle.build',
  clearLifecycle: 'lifecycle.build',
  upsertAllocation: 'capacity.allocate',
  removeAllocation: 'capacity.allocate',
  upsertCommitment: 'capacity.record',
  removeCommitment: 'capacity.record',
  /*
   * A working pattern is a fact about somebody's capacity, so it sits with the commitments
   * rather than with configuration.
   *
   * Correcting takes the same grant as recording, deliberately. The tempting alternative — a
   * higher bar for corrections, because they rewrite history — reads well and does not survive
   * contact: it makes the person who mistyped a date unable to fix it, so they record a second
   * overlapping period instead, which the reducer refuses, and the eventual workaround is worse
   * than the typo. A correction is already audited with both sides and a required reason, which
   * is the control that actually applies here.
   */
  // Rates have their own grant. `capacity.record` is about somebody's diary; this is about
  // their pay, and the two are not the same authority.
  recordRate: 'rate.edit',
  correctRate: 'rate.edit',
  /*
   * The FLOOR, not the whole rule. `skill.record` covers your own, self-rated; the reducer arms
   * additionally demand `skill.assess` for anybody else's row, or for the words "assessed" and
   * "certified". Exactly the `time.record` / `time.recordForOthers` split, and written here as
   * the weaker of the two deliberately — a funnel demanding the stronger one would stop a
   * consultant recording their own skills, which is how the directory gets filled at all.
   */
  recordPersonSkill: 'skill.record',
  correctPersonSkill: 'skill.record',
  removePersonSkill: 'skill.record',
  /*
   * `recordDocument` is the metadata half, and the bytes are already stored by the time it runs.
   * The upload endpoint therefore checks this same key BEFORE it reads the body — a permission
   * enforced only here would mean storing a file for somebody who was never allowed to attach
   * one, and then refusing to write the row that would let anybody find it again.
   */
  upsertScopeItem: 'scope.edit',
  removeScopeItem: 'scope.edit',
  decideScopeItem: 'scope.approve',
  upsertMilestone: 'milestone.edit',
  removeMilestone: 'milestone.edit',
  deliverMilestone: 'milestone.edit',
  decideMilestone: 'milestone.accept',
  recordDocument: 'document.upload',
  /* Asking rides on upload (whoever may put a deliverable on the record may ask about it);
   * answering needs its own key; withdrawing is the asker's act, gated like asking. */
  requestDocumentReview: 'document.upload',
  decideDocumentReview: 'document.review',
  withdrawDocumentReview: 'document.upload',
  // The floor. Withdrawing somebody ELSE's attachment additionally needs `document.remove`,
  // checked in the arm — the same shape as time and skills.
  removeDocument: 'document.upload',
  recordVersion: 'capacity.record',
  correctVersion: 'capacity.record',
  // Same grant as recording one. Withdrawing a version whose subject has left the directory is
  // the tail end of the same job, and the reducer's own guard is what keeps it narrow.
  removeVersion: 'capacity.record',
  // Raising or editing a variation is amending commercial scope, so it takes the same grant
  // as the statement of work itself. DECIDING one is its own authority.
  upsertChangeRequest: 'sow.edit',
  withdrawChangeRequest: 'sow.edit',
  decideChangeRequest: 'change.approve',
  upsertSow: 'sow.edit',
  archiveSow: 'sow.edit',
  attributeToSow: 'sow.attribute',
  updateEngagement: 'engagement.edit',
  config: 'config.manage',
  /*
   * The two that genuinely take no grant, said out loud rather than left out.
   *
   * `notify` is raised by rules and the scheduled pass, not by a person choosing to send
   * something — gating it on a human permission would mean the watch stops raising anything
   * the moment it runs as a machine actor. `markNotificationRead` acts on the reader's own
   * notification and grants nothing; requiring a permission to dismiss your own message is a
   * control with no risk behind it.
   */
  notify: null,
  markNotificationRead: null,
  /* The drain stamping what happened to a queued message after it happened — a record of an
   * outcome, not a grant. Never accepted over the wire; see the workspace endpoint's KINDS. */
  markNotificationDelivery: null,
}

/**
 * The permission an action needs, given what it is trying to do.
 *
 * `updateIssue` is the one action that needs the patch to decide: moving a record into a
 * closing status is a different act from correcting its subject, and a firm that lets an
 * analyst triage without letting them close needs those to be distinguishable.
 */
export function permissionForAction(
  kind: string,
  opts: { closing?: boolean } = {},
): PermissionKey | null {
  if (kind === 'updateIssue' && opts.closing) return 'work.close'
  return ACTION_PERMISSIONS[kind] ?? null
}

/* ================================================================== *
 * Validation
 * ================================================================== */

/** Problems with a policy, checked before it is stored. */
export function accessProblems(policy: AccessPolicy, roleIds: string[]): string[] {
  const out: string[] = []

  for (const [roleId, keys] of Object.entries(policy.grants)) {
    for (const k of keys) {
      if (!PERMISSION_KEYS.includes(k)) out.push(`“${roleId}” grants “${k}”, which is not a permission.`)
    }
  }

  const known = new Set([...roleIds, ADMIN_ROLE_ID])
  for (const r of policy.defaultRoleIds) {
    if (!known.has(r)) out.push(`The fallback role “${r}” does not exist.`)
  }

  // Somebody must be able to change the configuration, or this screen becomes the last one
  // anybody can use — including to undo the change that locked it.
  const canConfigure = Object.values(policy.grants).some((keys) => keys.includes('config.manage'))
  if (policy.enforced && !canConfigure) {
    out.push('No role could configure the platform — including to undo this change.')
  }

  /**
   * Somebody who actually exists must be able to configure the platform.
   *
   * The check above asks whether any *role* grants it, which is not the same question and let
   * the real lockout through: assign one person a client role, empty the fallback, and this
   * passed while nobody alive held `config.manage`. The configuration screen is then gated by
   * a permission nobody has, posting the action directly does not help because the reducer
   * gates it too, and unsetting the identity provider does not either — recovery means editing
   * the stored model in the database by hand.
   *
   * So the test is over the roles that are *reachable*: those somebody holds, plus the fallback
   * anyone unrecognised lands on.
   */
  const reachable = new Set([...roleIds, ...policy.defaultRoleIds])
  const someoneCanConfigure = [...reachable].some((r) =>
    (policy.grants[r] ?? []).includes('config.manage'),
  )
  if (policy.enforced && !someoneCanConfigure) {
    out.push(
      roleIds.length
        ? 'Nobody who holds a role could configure the platform after this change, and the fallback role cannot either. Give somebody a role that can first — otherwise this screen is the last one anybody can open.'
        : 'Nobody in the directory holds a role, and the fallback role cannot configure the platform. Assign someone a role first.',
    )
  }

  return out
}
