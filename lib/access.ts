import type { Actor } from './actor'
import type { OperatingModel } from './config'

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
  { key: 'approval.request', label: 'Ask for approval', what: 'Raise an approval against a record so it can proceed.' },
  { key: 'approval.decide', label: 'Decide an approval', what: 'Approve or reject. The rule also names which roles may — both are required.' },
  { key: 'estimate.edit', label: 'Estimate', what: 'Score complexity, set capacity and build a breakdown.' },
  { key: 'estimate.agree', label: 'Agree an estimate', what: 'Baseline it, after which changes need a reason.' },
  { key: 'lifecycle.build', label: 'Plan a lifecycle', what: 'Generate or clear the activity plan under an issue.' },
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
}

/** Administrator is a platform role, not a delivery one, which is why it is not in the seeded nine. */
export const ADMIN_ROLE_ID = 'ROLE_ADMIN'

const ALL: PermissionKey[] = [...PERMISSION_KEYS]

const DELIVERY_CORE: PermissionKey[] = [
  'work.create', 'work.edit', 'work.assign', 'work.close', 'work.schedule', 'work.link',
  'note.add', 'evidence.add', 'estimate.edit', 'lifecycle.build', 'time.record', 'approval.request',
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
  ROLE_ENGAGEMENT_LEAD: [...DELIVERY_CORE, 'approval.decide', 'time.recordForOthers', 'work.move', 'work.archive', 'work.restore', 'estimate.agree', 'engagement.edit', 'note.editAny', 'evidence.remove', 'config.manage'],
  ROLE_PRINCIPAL: [...DELIVERY_CORE, 'estimate.agree', 'work.move'],
  ROLE_PROJECT_MANAGER: [...DELIVERY_CORE, 'approval.decide', 'work.move', 'work.archive', 'work.restore', 'estimate.agree', 'engagement.edit', 'time.recordForOthers'],
  ROLE_FUNCTIONAL: [...DELIVERY_CORE],
  ROLE_TECHNICAL: [...DELIVERY_CORE],
  ROLE_SUPPORT: ['work.create', 'work.edit', 'work.assign', 'note.add', 'evidence.add', 'time.record'],
  // The one client role that decides anything: a sponsor is the person a change order is
  // actually put to, and a rule that names them is worthless if the grant does not.
  ROLE_CLIENT_SPONSOR: ['work.create', 'note.add', 'evidence.add', 'approval.decide'],
  ROLE_CLIENT_LEAD: ['work.create', 'note.add', 'evidence.add'],
  ROLE_CLIENT_USER: ['work.create', 'note.add'],
}

export function defaultAccessPolicy(): AccessPolicy {
  return {
    enforced: true,
    grants: Object.fromEntries(Object.entries(DEFAULT_GRANTS).map(([k, v]) => [k, [...v]])),
    // See the module comment. This is the line that should empty on the day a login exists.
    defaultRoleIds: [ADMIN_ROLE_ID],
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
  const people = Object.values(model.people ?? {})
  const person =
    people.find((p) => p.id === actor.id) ??
    people.find((p) => p.name.toLowerCase() === actor.name.toLowerCase())
  const own = (person?.roleIds ?? []).filter((r) => model.roles?.[r] && !model.roles[r].deletedAt)
  return own.length ? own : model.access.defaultRoleIds
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
 * working and nobody notices it was never guarded. Here, an action added without a permission
 * is a compile-time hole in a `Record`, and an action that genuinely needs no permission has to
 * say so with `null` rather than by omission.
 */
export const ACTION_PERMISSIONS: Record<string, PermissionKey | null> = {
  create: 'work.create',
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
  updateEngagement: 'engagement.edit',
  config: 'config.manage',
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

  const fallbackCanConfigure = policy.defaultRoleIds.some((r) =>
    (policy.grants[r] ?? []).includes('config.manage'),
  )
  if (policy.enforced && !fallbackCanConfigure && !roleIds.length) {
    out.push(
      'Nobody in the directory holds a role, and the fallback role cannot configure the platform. Assign someone a role first.',
    )
  }

  return out
}
