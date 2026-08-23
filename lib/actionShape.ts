import type { Action, ConfigOp, CreatableKind } from './workspace'
import type { EvidenceKind } from './evidence'
import type { ApprovalDecision } from './approval'
import type { DependencyType } from './types'
import { ACTIVITY_PHASES } from './types'
import { SNAPSHOT_PURPOSES } from './evidence'
import { NOTE_TYPES } from './notes'
import { TIME_ACTIVITIES } from './time'
import { COMMITMENT_KINDS } from './capacity'
import { SKILL_ORDER, SKILL_SOURCES } from './skills'
import { DOCUMENT_SUBJECTS, STORE_KINDS } from './documents'
import { BILLING_TRIGGERS, DELIVERY_STATES, MILESTONE_BASES } from './milestone'
import { SCOPE_KINDS, SCOPE_SOURCES } from './scope'

/**
 * Deciding whether an action is the shape it claims to be.
 *
 * The write endpoint already refuses an action whose *kind* is not on its allowlist. That is a
 * check on one field. Everything after it — every other key on the object, and the type of every
 * value — arrives unexamined, because the only thing that ever described those keys was the
 * `Action` union, and a TypeScript union is not present at runtime. `JSON.parse` hands the route
 * a `Record<string, unknown>` that a cast then calls an `Action`, and the cast is a promise the
 * compiler made to us about our own code, not a promise the network made to the server.
 *
 * That gap has teeth because of how the reducer builds records. Several arms do
 * `{ ...existing, ...a.patch }` — an object spread, which copies whatever keys it is given. So a
 * key the schema has never heard of does not bounce off the reducer; it lands in stored state
 * and is written back out on the next save. The same is true in the other direction: a field the
 * reducer *requires* but that never arrived is `undefined`, and `a.now.slice(0, 10)` on
 * `undefined` is a 500 for what is really a 400.
 *
 * So this module answers one question — "could this value have come from the `Action` union?" —
 * and answers it three ways at once:
 *
 *   Required fields   present, and of the declared type. Absent is refused rather than defaulted,
 *                     because a default would invent a value the caller never chose.
 *   Declared types    a string is a string and a number is finite. The reducer polices meaning
 *                     (does this id exist, is this date after that one); the boundary polices
 *                     type, which is the part the reducer assumes and cannot check cheaply.
 *   Unknown keys      refused. This is the one that closes the spread: an allowlist that only
 *                     checked the keys it knew about would pass `{ t, id, patch, now, isAdmin }`
 *                     without ever looking at `isAdmin`, and `isAdmin` is exactly the key an
 *                     attacker adds.
 *
 * This module is the decision alone — no database, no request, no clock, no `server-only`
 * import. It can be driven from a script with nothing running, which is the same split as
 * `idempotency.ts` against `lib/db/persist`, and `secretRules.ts` against `secrets.ts`. The
 * route calls it; the route is what turns a returned string into a 400.
 *
 * What it deliberately does NOT do is described under `plainObject` below. Read that before
 * concluding the endpoint is now closed.
 */

/* ================================================================== *
 * Vocabularies
 * ================================================================== */

/**
 * A literal list the compiler proves is exactly its union.
 *
 * Both directions matter and only one of them is obvious. A member that is not in the type is
 * caught by `L extends readonly T[]` — that is the obvious half, and it stops a typo widening
 * the gate. The subtle half is a member of the type that is *missing* from the list: nothing
 * about that is a type error on its own, and the symptom is not a security hole but a legitimate
 * write being refused — somebody adds a note type, ships it in the UI, and every note of that
 * type starts failing to save with a 400 nobody can explain. The `Exclude` witness turns that
 * into a build failure at the moment the union grows, which is the only moment anyone is looking.
 */
function allOf<T extends string>() {
  return <L extends readonly T[]>(
    list: L & ([Exclude<T, L[number]>] extends [never] ? unknown : never),
  ): ReadonlySet<string> => new Set<string>(list)
}

/**
 * Where the union is already backed by a runtime `as const` array, that array is imported rather
 * than retyped. A copy would be a second place to edit and would drift silently in the direction
 * that refuses good writes — see `allOf` — so the module that owns the vocabulary stays the only
 * place it is written down.
 */
const NOTE_KINDS: ReadonlySet<string> = new Set<string>(NOTE_TYPES)
const TIME_KINDS: ReadonlySet<string> = new Set<string>(TIME_ACTIVITIES)
const PURPOSES: ReadonlySet<string> = new Set<string>(SNAPSHOT_PURPOSES)
const COMMITMENTS: ReadonlySet<string> = new Set<string>(COMMITMENT_KINDS)

/** Declared inline in `lib/evidence.ts`, so there is no array to import; `allOf` guards the copy. */
const EVIDENCE_KINDS = allOf<EvidenceKind>()(['snapshot', 'data', 'document', 'link'] as const)
const DEPENDENCY_TYPES = allOf<DependencyType>()(['FS', 'SS', 'FF', 'SF'] as const)
const DECISIONS = allOf<ApprovalDecision>()(['approved', 'rejected'] as const)

/**
 * `CreatableKind` is assembled from three other unions, so this list is assembled the same way.
 *
 * `lib/workspace.ts` notes that deriving the type from `NodeKind` means "a new tier is creatable
 * without a second edit here". This is that second edit, and it is deliberate: a tier the browser
 * can create but the boundary has never heard of would be refused at the API with a 400, so the
 * validator has to learn about it too. `allOf` makes that a compile error rather than a bug
 * report — which is the whole difference between a rule and a comment.
 */
const CREATABLE_KINDS = allOf<CreatableKind>()([
  // `Exclude<NodeKind, 'company'>` — the company is the root and is never created through here.
  'client',
  'engagement',
  'project',
  'module',
  'issue',
  'sub-issue',
  ...ACTIVITY_PHASES,
  'Milestone',
] as const)

/**
 * The operations `config` will carry.
 *
 * Checked one level deep — that `op` is an object and that `op.k` is an operation that exists.
 * The fields *inside* each operation are not checked here, for the same reason `patch` is not:
 * see `plainObject`. Refusing an unknown `k` still matters on its own, because the reducer
 * switches on it and an unrecognised op falls through to a no-op that reports success.
 */
const CONFIG_OPS = allOf<ConfigOp['k']>()([
  'setLabel',
  'upsertRole',
  'deleteRole',
  'upsertWorkType',
  'deleteWorkType',
  'upsertDiscipline',
  'deleteDiscipline',
  'upsertSkill',
  'deleteSkill',
  'setSla',
  'setSizeBands',
  'setStatusPolicy',
  'setTimePolicy',
  'setAllocationPolicy',
  'setAccess',
  'setApprovalRules',
  'setAutomationRules',
  'setResourceProfile',
  'setWatch',
  'upsertPerson',
  'deletePerson',
  'upsertResponsibility',
  'deleteResponsibility',
  'setParties',
  'setAgent',
  'setWorkflowEnabled',
  'setScopeAgent',
  'setScopeRequired',
  'adoptTemplate',
  'upsertRoutingRule',
  'deleteRoutingRule',
  'upsertIntake',
  'deleteIntake',
  'upsertBlueprint',
  'deleteBlueprint',
  'upsertIntakeForm',
  'deleteIntakeForm',
  'upsertRecurrence',
  'deleteRecurrence',
  'setOrganization',
  'setDocumentFiling',
  'upsertGoal',
  'deleteGoal',
  'resetAll',
] as const)

/* ================================================================== *
 * Value checks
 * ================================================================== */

/**
 * How a value is described back to the developer.
 *
 * The *type* of what arrived, never the value itself. A 400 body is the one part of a rejected
 * request that travels back out of the system, and echoing the payload into it turns a validator
 * into a reflection gadget — a hostile string arrives, is refused, and is handed straight back to
 * whatever renders the error. The type is the part that is diagnostic anyway: a developer who
 * sent `hours: "3"` needs to be told they sent a string, not to be shown their own `"3"`.
 */
function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  switch (typeof value) {
    case 'string':
      return 'a string'
    case 'number':
      return 'a number'
    case 'boolean':
      return 'a boolean'
    case 'object':
      return 'an object'
    default:
      return typeof value
  }
}

/** Returns what is wrong with a value, phrased to follow "Field 'x' on kind ", or null. */
type Check = (value: unknown) => string | null

/** Free text: a caption, a note body, a reason. Empty is a legitimate thing for a person to send. */
const text: Check = (v) => (typeof v === 'string' ? null : `must be a string, received ${typeOf(v)}`)

/**
 * An identifier, which must additionally be non-empty.
 *
 * Stricter than `text` because an empty id cannot succeed further in: it will never match a
 * record, so the reducer answers "not found" and the client is told its edit lost a race it never
 * entered. Refusing it here names the real fault. This cannot refuse a legitimate write — no
 * caller has ever had a reason to address the record whose id is the empty string.
 */
const id: Check = (v) => {
  if (typeof v !== 'string') return `must be a string, received ${typeOf(v)}`
  return v ? null : 'must not be empty'
}

/** An id, or `null` where the union says null means "create a new one" rather than "missing". */
const idOrNull: Check = (v) => (v === null ? null : id(v))

/** Free text, or an explicit `null` — `url`, `mimeType` on evidence. */
const textOrNull: Check = (v) => (v === null ? null : text(v))

/**
 * A number the arithmetic downstream can survive.
 *
 * `Number.isFinite` rather than `typeof === 'number'` because JSON cannot carry `NaN` but very
 * much can carry `1e999`, which parses to `Infinity`. An infinite `hours` or `percentage`
 * propagates through every sum that touches it and turns a whole capacity report into `Infinity`
 * — a corruption with no single record to point at. Ranges are the reducer's business
 * (`lib/capacity.ts` decides what an over-allocation is); finiteness is a type property and
 * belongs here.
 */
const num: Check = (v) =>
  typeof v === 'number' && Number.isFinite(v) ? null : `must be a finite number, received ${typeOf(v)}`

const numOrNull: Check = (v) => (v === null ? null : num(v))

const bool: Check = (v) => (typeof v === 'boolean' ? null : `must be true or false, received ${typeOf(v)}`)

/** An array of strings — `setAssignment.values`, the people filling a responsibility. */
const strings: Check = (v) => {
  if (!Array.isArray(v)) return `must be an array, received ${typeOf(v)}`
  const bad = v.findIndex((x) => typeof x !== 'string')
  return bad === -1 ? null : `must contain only strings, but entry ${bad} is ${typeOf(v[bad])}`
}

/**
 * Long enough for any timestamp anyone writes, short enough that `now` cannot be used as storage.
 * The same reasoning as `MAX_KEY_LENGTH`: a field that is written down is a field with a budget.
 */
const MAX_TIMESTAMP_LENGTH = 64

/**
 * The clock the caller is acting at.
 *
 * Present on every arm of the union, so it is required on every shape here. Checked for
 * parseability rather than against a format regex, deliberately: the reducer's actual use is
 * `a.now.slice(0, 10)` and `new Date(a.now)`, so "a `Date` can read this" is the property that
 * matters, while pinning the exact output of `toISOString()` would refuse a timestamp with an
 * offset instead of a `Z` for no benefit to anything downstream.
 *
 * Not checked against the server's own clock. A browser with a wrong clock is a real and common
 * thing, and rejecting its work would lose it; attribution and ordering do not depend on this
 * value being honest, because the audit trail stamps its own.
 */
const timestamp: Check = (v) => {
  if (typeof v !== 'string') return `must be a string, received ${typeOf(v)}`
  if (!v) return 'must not be empty'
  if (v.length > MAX_TIMESTAMP_LENGTH) return `must be at most ${MAX_TIMESTAMP_LENGTH} characters`
  return Number.isFinite(Date.parse(v)) ? null : 'must be a readable timestamp'
}

/**
 * An ISO calendar date, which is not the same check as a timestamp.
 *
 * `Date.parse` accepts far more than this wants — "2026" and "Aug 17 2026" both parse and
 * neither sorts correctly as a string, which is the property the whole versioning module rests
 * on when it compares `validFrom` to a query date.
 */
const isoDate: Check = (v) => {
  if (typeof v !== 'string') return `must be a string, received ${typeOf(v)}`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'must be a date as YYYY-MM-DD'
  return Number.isFinite(Date.parse(v)) ? null : 'must be a real date'
}
const isoDateOrNull: Check = (v) => (v === null ? null : isoDate(v))

/**
 * What can be versioned, as a closed list.
 *
 * `value` below is deliberately unchecked — it is JSON typed by the kind, and this module
 * cannot know the shape of a working pattern without importing the domain it is validating.
 * Bounding the *kind* is what keeps that from being a hole: an unrecognised subject is refused
 * here, so the unchecked value can only ever belong to something this build understands.
 */
const SUBJECT_KINDS: ReadonlySet<string> = new Set(['person.workingPattern'])

/** Anything at all. Only ever used where a closed `subjectKind` already bounds the payload. */
const opaque: Check = () => null

/** One of a closed vocabulary. The allowed values are ours, so listing them back is safe. */
function oneOf(allowed: ReadonlySet<string>): Check {
  return (v) => {
    if (typeof v !== 'string') return `must be a string, received ${typeOf(v)}`
    return allowed.has(v) ? null : `must be one of: ${[...allowed].join(', ')}`
  }
}

/**
 * Keys that must never appear on any object this endpoint accepts, at any depth it inspects.
 *
 * Not a type check — a name check. `JSON.parse('{"__proto__":{}}')` produces an ordinary own
 * property rather than triggering the setter, so a spread copies it through as a literal key
 * called `__proto__` and it is then stored, reloaded, and spread again by code that has every
 * reason to assume no such key exists. Refusing the name costs nothing: no record in this
 * workspace has a field called `__proto__`, `constructor` or `prototype`, so nothing legitimate
 * is turned away.
 */
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * A patch: an object whose keys are copied into a stored record by an object spread.
 *
 * THIS IS THE DOCUMENTED LIMIT OF THIS MODULE, and it is a choice rather than an oversight.
 * What is checked is that the value is a plain object rather than an array, a string or `null` —
 * enough that `{ ...existing, ...a.patch }` cannot smuggle numeric keys in from an array or throw
 * on a primitive. What is NOT checked is the set of keys inside it.
 *
 * Checking those would mean a hand-maintained field list per record type — `IssueRecord`,
 * `HierarchyNode`, `ActivityRec`, `EvidenceItem`, `IssueNote`, `Estimate`, `TimeEntry`, `Sow`,
 * `EngagementDetail` — eight interfaces across six files, none of which has a runtime
 * representation to import. An incomplete list there does not fail safe: it refuses a legitimate
 * edit, and the symptom is one field quietly not saving while everything around it does. That is
 * a worse defect than the one being fixed, which the scenario itself records as latent. The
 * honest close is a runtime field registry generated from the schema, which is a change to
 * `lib/types.ts` and the record modules rather than to this file.
 *
 * The same reasoning covers `create.draft` — whose declared type is `Record<string, string>`, so
 * unknown keys there are legitimate by definition and only the *values* can be checked — and
 * `config.op`, whose per-operation fields are spread by `setSla`, `setAccess` and `setWatch`
 * exactly as `patch` is. All three are one consistent gap, named here rather than half-closed.
 */
const plainObject: Check = (v) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return `must be an object, received ${typeOf(v)}`
  }
  for (const k of Object.keys(v)) {
    if (RESERVED_KEYS.has(k)) return `must not carry the key '${k}'`
  }
  return null
}

/** `create.draft` — a plain object, and every value in it a string, which its type does promise. */
const draft: Check = (v) => {
  const problem = plainObject(v)
  if (problem) return problem
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val !== 'string') return `must hold only strings, but '${k}' is ${typeOf(val)}`
  }
  return null
}

/** `config.op` — an object carrying an operation this build knows how to perform. */
const configOp: Check = (v) => {
  const problem = plainObject(v)
  if (problem) return problem
  const k = (v as { k?: unknown }).k
  if (typeof k !== 'string') return `must carry a string 'k', received ${typeOf(k)}`
  return CONFIG_OPS.has(k) ? null : `carries an unrecognised operation '${k}'`
}

/* ================================================================== *
 * Shapes
 * ================================================================== */

/** A field, and whether the union declares it with a `?`. */
interface Field {
  check: Check
  /**
   * Absent is allowed. Present is still checked — an optional field with a wrong-typed value is
   * a bug, not a shrug, and letting it through would make `reason?: string` a hole exactly as
   * wide as a required one.
   */
  optional?: boolean
}

type Shape = Record<string, Field>

const req = (check: Check): Field => ({ check })
const opt = (check: Check): Field => ({ check, optional: true })

/** Every arm carries one; hoisted so thirty-eight shapes do not each rebuild it. */
const now = req(timestamp)

/**
 * The contents of a `patch`, not merely that one was sent.
 *
 * `patch: req(plainObject)` established that the value is an object and stopped there — so
 * `{ ownerr: 'Priya' }` and `{ status: 12345 }` both passed. That is the exact risk this module
 * was written for: the reducer merges a patch with `{ ...record, ...patch }`, so an unrecognised
 * key is spread into the record and a mistyped one replaces a real field with the wrong type.
 * Checking the envelope and waving the payload through covers the request shape and misses the
 * writes.
 *
 * Shape only. Whether `status` is a status this firm uses is the reducer's question — it owns
 * the transition graph and answers with a sentence naming the routes that exist, which is a
 * better answer than anything available here. Duplicating it would create two lists free to
 * disagree, which is the failure the status policy was extracted to prevent.
 *
 * An empty patch is allowed. It changes nothing, the reducer treats it as a no-op, and refusing
 * it would turn a harmless client quirk into a halted queue.
 */
const patchOf = (fields: Record<string, Check>): Check => {
  const known = new Set(Object.keys(fields))
  return (v) => {
    const flat = plainObject(v)
    if (flat) return flat
    const patch = v as Record<string, unknown>
    for (const key of Object.keys(patch)) {
      if (!known.has(key)) return `carries unrecognised field '${key}'`
      // `undefined` means "not set" from a spread, not an attempt to write one.
      if (patch[key] === undefined) continue
      const problem = fields[key](patch[key])
      // Reads as one sentence with the wrapper: "Field 'patch' on updateIssue carries 'status'
      // which must be a string, received a number."
      if (problem) return `carries '${key}' which ${problem}`
    }
    return null
  }
}

/**
 * One entry per arm of `Action`, transcribed from the union in `lib/workspace.ts`.
 *
 * `satisfies Record<Exclude<Action['t'], 'notify'>, Shape>` is the load-bearing line, and it does
 * two jobs:
 *
 *   1. It makes the table provably complete. Add an arm to `Action` and this file stops
 *      compiling until it has a shape — so the failure mode of a growing vocabulary is a build
 *      error rather than a new kind that reaches the reducer unexamined.
 *   2. It is where the `notify` refusal lives, as a type rather than as a comment. Notifications
 *      are raised by rules, and the server plans the same rules the browser does, so a `notify`
 *      arriving over the wire could only be one the client invented. The route's `KINDS` set
 *      leaves it out; the `Exclude` here means this table *cannot* quietly let it back in, even
 *      by someone transcribing the union straight down the page. `validatedKinds()` exists so
 *      the two lists can be checked against each other rather than trusted to agree.
 */
const SHAPES = {
  /* ---- CRUD ---- */
  create: { parentId: req(id), kind: req(oneOf(CREATABLE_KINDS)), draft: req(draft), now },
  /**
   * Four fields, and none of them is the relationship.
   *
   * The `DUPLICATE_OF` is minted by the reducer and cannot be named, retyped or turned off from
   * the wire — so there is deliberately no `relationshipType` here to be widened later, and no
   * boolean an over-helpful client could send as false. `note` rides on the relationship, as it
   * does on `link`, and empty is a legitimate thing for a person to send.
   */
  duplicate: { issueId: req(id), note: req(text), now },
  updateNode: { id: req(id), patch: req(plainObject), now },
  updateIssue: {
    id: req(id),
    /**
     * Transcribed from `IssueRecord`, minus `id` — an issue cannot be renamed into another one
     * by a patch, and letting it through would let a write land on a record nobody named.
     */
    patch: req(
      patchOf({
        parentId: idOrNull, client: text, module: text, subject: text, description: text,
        type: text, sourceType: text, discipline: text, severity: text, status: text, owner: text,
        raisedBy: text, accountable: text, raised: textOrNull, lastActivity: textOrNull,
        actualEnd: textOrNull, age: num, daysSinceActivity: num, nextAction: text,
        evidence: text, evidenceDate: textOrNull, verification: text, source: text,
        reference: text, clientImpact: text, plannedStart: textOrNull, plannedEnd: textOrNull,
        percentOverride: numOrNull, scheduleMode: text, assignments: plainObject,
        clientVisible: bool,
        deletedAt: textOrNull,
      }),
    ),
    now,
    /**
     * Set when the person has been told the record is not available and has decided to assign
     * anyway. Declared here rather than allowed as a rider, because it means something only on
     * an action that names an owner — riding along elsewhere would read as though the server
     * had weighed an availability it never looked at.
     */
    acceptUnavailable: opt(bool),
    reason: opt(text),
    /**
     * The concurrency check — what the person could see when they decided to change this.
     * Optional because two callers have nothing to be stale against, so absent means "unchecked"
     * rather than "missing"; refusing it here would break the automation and intake paths that
     * legitimately have no prior version to quote.
     */
    expected: opt(plainObject),
  },
  updateActivity: { id: req(id), patch: req(plainObject), now },
  softDelete: { id: req(id), mode: req(oneOf(new Set(['cascade', 'reparent']))), now },
  restore: { id: req(id), now },
  /* ---- HIERARCHY ---- */
  move: { id: req(id), newParentId: req(id), now },
  /* ---- RELATIONSHIPS ---- */
  link: {
    sourceIssueId: req(id),
    targetIssueId: req(id),
    /** Declared as an open `string`, so it is checked as one. Inventing an enum here would
     *  refuse relationship labels the operating model is allowed to define. */
    relationshipType: req(text),
    note: req(text),
    now,
  },
  unlink: { id: req(id), now },
  /* ---- SCHEDULING ---- */
  /** `start` and `end` are day strings the schedule interprets; the calendar meaning is
   *  `lib/dates.ts` and the reducer's to police, the string-ness is this boundary's. */
  setDates: { id: req(id), start: req(text), end: req(text), now, reason: opt(text) },
  addDependency: {
    predecessorId: req(id),
    successorId: req(id),
    dependencyType: req(oneOf(DEPENDENCY_TYPES)),
    lagDays: req(num),
    now,
  },
  removeDependency: { id: req(id), now },
  /* ---- EVIDENCE ---- */
  addEvidence: {
    issueId: req(id),
    kind: req(oneOf(EVIDENCE_KINDS)),
    name: req(text),
    /**
     * Nullable-required, not optional — and the distinction is the one most easily got wrong.
     * The union says `purpose: SnapshotPurpose | null`, so an explicit `null` is a real answer
     * ("this is not a snapshot") and must pass, while the field being absent means the client
     * never decided and must not. `url`, `mimeType` and `sizeBytes` are the same.
     */
    purpose: req((v) => (v === null ? null : oneOf(PURPOSES)(v))),
    url: req(textOrNull),
    mimeType: req(textOrNull),
    sizeBytes: req(numOrNull),
    note: req(text),
    now,
  },
  updateEvidence: { id: req(id), patch: req(plainObject), now },
  removeEvidence: { id: req(id), now },
  /* ---- NOTES ---- */
  addNote: {
    issueId: req(id),
    body: req(text),
    noteType: req(oneOf(NOTE_KINDS)),
    pinned: req(bool),
    clientVisible: opt(bool),
    now,
  },
  updateNote: { id: req(id), patch: req(plainObject), now },
  removeNote: { id: req(id), now },
  /* ---- ESTIMATION ---- */
  setEstimate: { issueId: req(id), patch: req(plainObject), reason: opt(text), now },
  baselineEstimate: { issueId: req(id), now },
  /* ---- TIME ---- */
  addTime: {
    issueId: req(id),
    person: req(text),
    date: req(text),
    hours: req(num),
    activity: req(oneOf(TIME_KINDS)),
    billable: req(bool),
    note: req(text),
    justification: opt(text),
    now,
  },
  updateTime: { id: req(id), patch: req(plainObject), now },
  removeTime: { id: req(id), now },
  /* ---- APPROVAL ---- */
  requestApproval: { subjectId: req(id), ruleId: req(text), note: req(text), now },
  decideApproval: { id: req(id), decision: req(oneOf(DECISIONS)), note: req(text), now },
  /* ---- NOTIFICATION ---- */
  markNotificationRead: { id: req(id), now },
  markNotificationDelivery: {
    id: req(id),
    delivery: req(oneOf(new Set(['delivered', 'pending', 'failed']))),
    note: req(text),
    now,
  },
  /* ---- COMMERCIAL ---- */
  /** `id: null` is how an upsert says "insert"; see the nullable-required note on `addEvidence`. */
  upsertSow: { id: req(idOrNull), engagementId: req(id), patch: req(plainObject), now },
  archiveSow: { id: req(id), now },
  attributeToSow: { nodeId: req(id), sowId: req(idOrNull), now },
  /* ---- CAPACITY ---- */
  upsertAllocation: {
    id: req(idOrNull),
    person: req(text),
    projectId: req(id),
    startDate: req(text),
    endDate: req(text),
    percentage: req(num),
    note: req(text),
    /** Optional by design: absent means "I did not ask to overcommit anyone", which is the
     *  safe reading. The reducer refuses the overallocation itself when this is missing. */
    acceptOverallocation: opt(bool),
    now,
  },
  removeAllocation: { id: req(id), now },
  upsertCommitment: {
    id: req(idOrNull),
    person: req(text),
    kind: req(oneOf(COMMITMENTS)),
    startDate: req(text),
    endDate: req(text),
    hoursPerDay: req(num),
    note: req(text),
    now,
  },
  removeCommitment: { id: req(id), now },
  /* ---- LIFECYCLE ---- */
  buildLifecycle: { issueId: req(id), slaDays: req(num), now },
  clearLifecycle: { issueId: req(id), now },
  /* ---- CONFIGURATION ---- */
  config: { op: req(configOp), now },
  updateEngagement: { nodeId: req(id), patch: req(plainObject), now },
  // `acceptUnavailable` for the same reason as `updateIssue`: this is the other arm that can
  // name somebody, and the reducer refuses both when that person is away for the whole window.
  recordVersion: {
    subjectKind: req(oneOf(SUBJECT_KINDS)),
    subjectId: req(id),
    validFrom: req(isoDate),
    validTo: opt(isoDateOrNull),
    value: req(opaque),
    reason: req(text),
    now,
  },
  removeVersion: { id: req(id), now },
  correctVersion: {
    id: req(id),
    patch: req(
      patchOf({ validFrom: isoDate, validTo: isoDateOrNull, value: opaque }),
    ),
    reason: req(text),
    now,
  },
  upsertChangeRequest: {
    id: req(idOrNull),
    sowId: req(id),
    patch: req(
      patchOf({
        issueId: idOrNull,
        reference: text,
        title: text,
        effortHours: num,
        value: num,
        currency: text,
        scope: text,
        reason: text,
        effectiveFrom: isoDateOrNull,
      }),
    ),
    submit: opt(bool),
    now,
  },
  withdrawChangeRequest: { id: req(id), now },
  decideChangeRequest: {
    id: req(id),
    decision: req(oneOf(new Set(['approved', 'rejected']))),
    note: opt(text),
    now,
  },
  recordRate: {
    personId: req(id),
    kind: req(oneOf(new Set(['cost', 'bill']))),
    validFrom: req(isoDate),
    validTo: opt(isoDateOrNull),
    amount: req(num),
    currency: req(text),
    reason: req(text),
    now,
  },
  correctRate: {
    id: req(id),
    patch: req(patchOf({ validFrom: isoDate, validTo: isoDateOrNull, amount: num, currency: text })),
    reason: req(text),
    now,
  },
  recordPersonSkill: {
    personId: req(id),
    skillId: req(id),
    level: req(oneOf(new Set(SKILL_ORDER))),
    source: req(oneOf(new Set(SKILL_SOURCES))),
    assessedBy: req(textOrNull),
    lastUsedOn: req(isoDateOrNull),
    note: req(text),
    now,
  },
  correctPersonSkill: {
    id: req(id),
    patch: req(
      patchOf({
        level: oneOf(new Set(SKILL_ORDER)),
        source: oneOf(new Set(SKILL_SOURCES)),
        assessedBy: textOrNull,
        lastUsedOn: isoDateOrNull,
        note: text,
      }),
    ),
    now,
  },
  removePersonSkill: { id: req(id), now },
  /*
   * Reachable over the wire, and that is a deliberate decision rather than an oversight.
   *
   * The bytes arrive at `/api/documents`, which stores them and then calls the reducer directly
   * — so this shape is not needed for the normal path. It is here because the browser applies
   * every action optimistically through one queue, and an action the endpoint refuses to replay
   * would leave the client's copy permanently ahead of the server's.
   *
   * What that costs: somebody could POST a `recordDocument` naming a locator nobody stored. The
   * result is a row whose download 404s and says so — bounded, visible, and the same outcome as
   * a file deleted in SharePoint, which is a case that has to be handled anyway.
   */
  recordDocument: {
    subjectKind: req(oneOf(new Set(DOCUMENT_SUBJECTS))),
    subjectId: req(id),
    name: req(text),
    mimeType: req(text),
    sizeBytes: req(num),
    checksum: req(text),
    locator: req(text),
    store: req(oneOf(new Set(STORE_KINDS))),
    note: req(text),
    evidenceId: opt(idOrNull),
    supersedesId: opt(idOrNull),
    clientVisible: opt(bool),
    now,
  },
  removeDocument: { id: req(id), now },
  setDocumentVisibility: { id: req(id), clientVisible: req(bool), now },
  /* ---- PROOFING ---- */
  requestDocumentReview: { documentId: req(id), reviewers: req(strings), question: req(text), now },
  decideDocumentReview: {
    reviewId: req(id),
    verdict: req(oneOf(new Set(['approved', 'changes']))),
    note: req(text),
    now,
  },
  withdrawDocumentReview: { reviewId: req(id), now },
  upsertMilestone: {
    id: req(idOrNull),
    sowId: req(id),
    patch: req(
      patchOf({
        name: text,
        description: text,
        sequence: num,
        basis: oneOf(new Set(MILESTONE_BASES)),
        percentage: num,
        amount: num,
        currency: text,
        billOn: oneOf(new Set(BILLING_TRIGGERS)),
        plannedDate: isoDateOrNull,
        delivery: oneOf(new Set(DELIVERY_STATES)),
      }),
    ),
    now,
  },
  upsertScopeItem: {
    id: req(idOrNull),
    sowId: req(id),
    patch: req(
      patchOf({
        kind: oneOf(new Set(SCOPE_KINDS)),
        text,
        parentId: idOrNull,
        effortHours: numOrNull,
        source: oneOf(new Set(SCOPE_SOURCES)),
        sequence: num,
      }),
    ),
    now,
  },
  removeScopeItem: { id: req(id), now },
  decideScopeItem: {
    id: req(id),
    // `false` un-agrees a line that was agreed in error. Not a separate action, because it is
    // the same decision reversed and the audit reads better as one field changing twice.
    approved: req(bool),
    now,
  },
  removeMilestone: { id: req(id), now },
  deliverMilestone: { id: req(id), now },
  decideMilestone: {
    id: req(id),
    // `Pending` is deliberately not on the wire. Un-deciding a milestone is not a decision, and
    // a returned one comes back through `deliverMilestone` when it is presented again.
    decision: req(oneOf(new Set(['Accepted', 'Rejected']))),
    note: opt(text),
    evidenceDocumentId: opt(idOrNull),
    now,
  },
  submitTimesheet: {
    person: req(id),
    weekStarting: req(isoDate),
    now,
  },
  decideTimesheet: {
    id: req(id),
    // The two the reducer acts on. `oneOf` echoes the allowed values back, which is safe
    // because they are ours.
    decision: req(oneOf(new Set(['approved', 'rejected']))),
    reason: opt(text),
    now,
  },
  setAssignment: {
    issueId: req(id), responsibilityId: req(id), values: req(strings), now,
    acceptUnavailable: opt(bool),
  },
} satisfies Record<Exclude<Action['t'], 'notify'>, Shape>

/**
 * Keys allowed on every action regardless of kind.
 *
 *   `t`    the discriminator itself, which is what selected the shape.
 *   `key`  the idempotency stamp. It is transport metadata rather than part of the vocabulary —
 *          `split()` strips it before the reducer ever sees the action — so no shape declares it
 *          and every shape has to tolerate it. Its *content* is not checked here on purpose:
 *          `keyProblem` in `lib/idempotency.ts` owns that rule and reports it well, and two
 *          different 400s for one field would send a developer chasing the wrong module.
 *
 * `now` and `expected` are not in this set, and that is not an oversight. Both are declared
 * fields of the union — `now` on every arm, `expected` on `updateIssue` alone — so they are
 * carried by the shapes above and get checked like anything else. Putting them here instead
 * would let `expected` ride along on an action that has no concurrency check to perform, which
 * would read as though the server were honouring one.
 */
const RIDERS = new Set(['t', 'key'])

/* ================================================================== *
 * The check
 * ================================================================== */

/**
 * What is wrong with a submitted action, or null if nothing is.
 *
 * A string rather than a boolean, and a specific one. A developer holding a 400 that says
 * "invalid payload" has to bisect their own request to find out what the server objected to,
 * which for a batch of two hundred means they mostly do not bother — so the endpoint's only
 * feedback channel gets ignored and the bad client ships. Naming the field and the kind turns
 * the same response into a fix. The message never contains the submitted value; see `typeOf`.
 *
 * Pure: no clock, no request, no I/O. That is what lets `scripts/scenario-validation.ts` drive
 * it directly with hand-built hostile objects, instead of asserting that a regex matches the
 * route's source and calling it evidence.
 */
export function actionProblem(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return `An action must be an object, received ${typeOf(value)}.`
  }

  const action = value as Record<string, unknown>
  const kind = action.t

  if (typeof kind !== 'string') return `An action must carry a string 't', received ${typeOf(kind)}.`
  if (!Object.prototype.hasOwnProperty.call(SHAPES, kind) || RESERVED_KEYS.has(kind)) {
    /*
     * Reached for `notify` too, which is the point: it is absent from `SHAPES` by type, so it
     * cannot be readmitted here by accident. `hasOwnProperty` rather than `in` because `in` walks
     * the prototype chain and would happily report that `SHAPES` has a kind called `toString`.
     */
    return `Unrecognised action kind '${kind}'.`
  }
  const shape = SHAPES[kind as keyof typeof SHAPES] as Shape

  /*
   * Unknown keys first, before any declared field is examined.
   *
   * Order matters for the message a developer sees. An action carrying both a typo'd key and a
   * mistyped value is almost always one mistake — the typo — and reporting the typo names it,
   * while reporting the type first sends them to look at a field that is fine. It also means the
   * check that closes the spread is the one that cannot be skipped by an earlier return.
   */
  for (const field of Object.keys(action)) {
    if (RIDERS.has(field)) continue
    if (!Object.prototype.hasOwnProperty.call(shape, field)) {
      return `Unrecognised field '${field}' on ${kind}.`
    }
  }

  for (const [field, spec] of Object.entries(shape)) {
    const present = Object.prototype.hasOwnProperty.call(action, field)
    if (!present) {
      /*
       * `undefined` is treated as absent rather than as a value. JSON cannot express it, so any
       * `undefined` here came from our own code building the object, and refusing it would fail
       * a request the union says is legal.
       */
      if (spec.optional) continue
      return `Missing field '${field}' on ${kind}.`
    }
    const problem = spec.check(action[field])
    if (problem) return `Field '${field}' on ${kind} ${problem}.`
  }

  return null
}

/**
 * What is wrong with a submitted batch, or null.
 *
 * Reports the first fault and stops. Collecting every fault would read as more helpful and is
 * not: a batch is one client's serial queue, so its actions come from one code path and its
 * faults are one bug repeated — a hundred copies of the same sentence buries the one that
 * matters. Stopping also bounds the work a hostile body can ask the server to do.
 *
 * The position is included only when there is more than one action to disambiguate, because
 * "at index 0" on a single-action request is noise a reader has to discard.
 */
export function batchProblem(list: readonly unknown[]): string | null {
  for (let i = 0; i < list.length; i++) {
    const problem = actionProblem(list[i])
    if (problem) return list.length > 1 ? `Action at index ${i}: ${problem}` : problem
  }
  return null
}

/**
 * The kinds this module will validate.
 *
 * Exported so the route's `KINDS` allowlist and this table can be checked against each other
 * rather than assumed to agree. They are two lists maintained by hand in two files, and the two
 * ways they can disagree fail in opposite directions: a kind in `KINDS` with no shape here would
 * be a hole reopened, and a shape here for a kind `KINDS` refuses would be dead code that reads
 * like protection. `scripts/scenario-validation.ts` asserts the equality, so a drift is a failing
 * scenario rather than a discovery.
 */
export function validatedKinds(): string[] {
  return Object.keys(SHAPES)
}
