/**
 * Axiomate TMS — assistant domain.
 *
 * The assistant can do three things, and only three: find issues, propose a new issue, and
 * propose a change to an existing one. It never writes. A proposal is a *description* of a
 * mutation that the user has to accept; accepting it dispatches the ordinary workspace action,
 * so validation and the History trail apply exactly as they do for the grid and the forms.
 *
 * Everything here is pure and runs on both sides of the wire:
 *   - the route uses it to execute the search tool and to sanity-check what the model returned;
 *   - the client uses it to re-validate the route's response before dispatching.
 *
 * The client-side check is the one that matters. A proposal is model output, and model output
 * is untrusted input: nothing in the reducer runtime-checks that a status is one of the seven
 * real statuses, because until now every write came from a <select> that could not produce
 * anything else. This module is that missing gate.
 */

import { ISSUE_STATUSES, type IssueStatus } from './types'

/* ================================================================== *
 * Wire shapes
 * ================================================================== */

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * One row of the catalogue the client posts with every turn. Deliberately flat and small —
 * this is the assistant's whole view of the workspace, and it travels on each request because
 * the workspace lives in the browser, not in a database.
 */
export interface IssueIndexEntry {
  id: string
  subject: string
  client: string
  module: string
  status: string
  severity: string
  owner: string
  accountable: string
  health: string
  plannedStart: string | null
  plannedEnd: string | null
  nextAction: string
}

/** Upper bound on a posted catalogue, so the route cannot be used as a token pump. */
export const MAX_INDEX_ROWS = 2000
export const MAX_HISTORY_TURNS = 12

export interface UpdateProposal {
  kind: 'update'
  id: string
  /** Non-date fields. Applied with `{ t: 'updateIssue' }`. */
  patch: Record<string, string>
  /** Applied with `{ t: 'setDates' }` — the same action the Gantt drag uses. */
  dates: { start: string; end: string } | null
  rationale: string
}

export interface CreateProposal {
  kind: 'create'
  /** Where it should live. Resolved to a real parent row by the workspace. */
  client: string
  module: string
  /** Shaped for the `create` action's `draft` — `name` is the subject. */
  draft: Record<string, string>
  rationale: string
}

export type Proposal = UpdateProposal | CreateProposal

export interface ChatReply {
  text: string
  /** Issue ids the assistant looked at, surfaced as chips the user can jump to. */
  matches: string[]
  proposals: Proposal[]
  /** Which brain answered. Shown in the UI so the user is never unsure. */
  engine: 'claude' | 'offline'
  model?: string
  /** Fields the model got wrong and we dropped, so the failure is visible rather than silent. */
  rejected: string[]
}

/**
 * The operating model, as far as the assistant needs it.
 *
 * Posted with every turn rather than imported, because the assistant runs on the server and
 * the configuration lives in the browser. Without this the assistant would validate against
 * the *shipped* vocabulary and prompt with the *shipped* terminology — so renaming "Owner" to
 * "Resolution Lead" would rename it everywhere except the one surface that talks in sentences.
 */
export interface ChatConfig {
  /** What this workspace calls each responsibility and field. */
  terms: {
    owner: string
    accountable: string
    raisedBy: string
    issue: string
    module: string
    organization: string
  }
  /** The configured accountable-party vocabulary. */
  parties: string[]
  /** How much the assistant may do here, from the agent registry. */
  autonomy: 'off' | 'suggest' | 'propose' | 'act'
}

export const DEFAULT_CHAT_CONFIG: ChatConfig = {
  terms: {
    owner: 'Owner',
    accountable: 'Accountable Party',
    raisedBy: 'Raised By',
    issue: 'Issue',
    module: 'Process Area',
    organization: 'Client',
  },
  parties: ['Axiocloud', 'OAPIL', 'SLG', 'Shared', 'Unassigned'],
  autonomy: 'propose',
}

/** Whether this turn is allowed to produce proposals at all. */
export function canPropose(cfg: ChatConfig): boolean {
  return cfg.autonomy === 'propose' || cfg.autonomy === 'act'
}

export interface ChatRequest {
  messages: ChatMessage[]
  index: IssueIndexEntry[]
  today: string
  config: ChatConfig
}

/* ================================================================== *
 * Vocabulary
 * ================================================================== */

/**
 * Fields a proposal may touch. Deliberately short: identity, provenance and audit fields
 * (`raised`, `source`, `verification`, `age`, …) are records of what happened and are not the
 * assistant's to rewrite.
 */
export const PATCHABLE_FIELDS = [
  'status',
  'severity',
  'owner',
  'accountable',
  'nextAction',
  'subject',
  'description',
  'type',
] as const
export type PatchableField = (typeof PATCHABLE_FIELDS)[number]

export const SEVERITIES = ['High', 'Medium', 'Low'] as const
export const ACCOUNTABLE = ['Axiocloud', 'OAPIL', 'SLG', 'Shared', 'Unassigned'] as const

/**
 * Legal values for the closed-vocabulary fields.
 *
 * `accountable` is configurable — it names organisations you work with — so it comes from the
 * posted configuration. Status and severity do not: they drive `STATUS_PROGRESS` and
 * `computeHealth`, and validating against a user-extended list would let the assistant write
 * a status the schedule cannot interpret.
 */
export function enumsFor(cfg: ChatConfig): Record<string, readonly string[]> {
  return {
    status: ISSUE_STATUSES,
    severity: SEVERITIES,
    accountable: cfg.parties.length ? cfg.parties : ACCOUNTABLE,
  }
}

/** Shipped vocabularies, used where no configuration has been posted. */
export const ENUMS: Record<string, readonly string[]> = {
  status: ISSUE_STATUSES,
  severity: SEVERITIES,
  accountable: ACCOUNTABLE,
}

const TERMINAL_STATUSES: readonly string[] = [
  'Closed - confirmed',
  'Closed - no defect',
  'Superseded',
]

export function isTerminalStatus(s: string): boolean {
  return TERMINAL_STATUSES.includes(s)
}

/** Format *and* calendar validity — `2026-02-31` parses in JS but is not a date. */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/* ================================================================== *
 * Validation — the gate between model output and the reducer
 * ================================================================== */

export interface Validated<T> {
  value: T | null
  /** Human-readable notes about what was dropped and why. */
  rejected: string[]
}

/**
 * Filter a field bag down to what is legal, dropping anything else with a reason.
 * Rejecting beats coercing: silently mapping "Critical" onto "High" would put a value in the
 * record that nobody asked for and nobody can trace.
 */
function cleanFields(
  raw: Record<string, unknown>,
  label: string,
  enums: Record<string, readonly string[]>,
): Validated<Record<string, string>> {
  const out: Record<string, string> = {}
  const rejected: string[] = []

  for (const [k, rawV] of Object.entries(raw)) {
    if (!(PATCHABLE_FIELDS as readonly string[]).includes(k)) {
      rejected.push(`${label}: “${k}” is not a field the assistant may set.`)
      continue
    }
    const v = str(rawV)
    if (!v) continue
    const allowed = enums[k]
    if (allowed && !allowed.includes(v)) {
      rejected.push(`${label}: “${v}” is not a valid ${k}. Allowed: ${allowed.join(', ')}.`)
      continue
    }
    if (v.length > 2000) {
      rejected.push(`${label}: ${k} was too long and was dropped.`)
      continue
    }
    out[k] = v
  }
  return { value: out, rejected }
}

function cleanDates(
  rawStart: unknown,
  rawEnd: unknown,
  label: string,
): Validated<{ start: string; end: string } | null> {
  const start = str(rawStart)
  const end = str(rawEnd)
  if (!start && !end) return { value: null, rejected: [] }
  if (!start || !end) {
    return { value: null, rejected: [`${label}: a schedule change needs both a start and an end date.`] }
  }
  if (!isIsoDate(start) || !isIsoDate(end)) {
    return { value: null, rejected: [`${label}: dates must be real calendar dates in YYYY-MM-DD form.`] }
  }
  if (end < start) {
    return { value: null, rejected: [`${label}: the end date falls before the start date.`] }
  }
  return { value: { start, end }, rejected: [] }
}

/** Validate a proposed update against the catalogue. Returns null if nothing survives. */
export function validateUpdate(
  raw: Record<string, unknown>,
  index: IssueIndexEntry[],
  cfg: ChatConfig = DEFAULT_CHAT_CONFIG,
): Validated<UpdateProposal> {
  const rejected: string[] = []
  const id = str(raw.issue_id).toUpperCase()
  const known = index.find((e) => e.id.toUpperCase() === id)
  if (!known) {
    return { value: null, rejected: [`No issue “${str(raw.issue_id) || '(none given)'}” exists.`] }
  }

  const fields = cleanFields((raw.fields as Record<string, unknown>) ?? {}, id, enumsFor(cfg))
  rejected.push(...fields.rejected)
  const dates = cleanDates(raw.planned_start, raw.planned_end, id)
  rejected.push(...dates.rejected)

  const patch = fields.value ?? {}
  // Drop no-ops so the card never offers a change that would do nothing.
  for (const k of Object.keys(patch)) {
    const current = (known as unknown as Record<string, unknown>)[k]
    if (typeof current === 'string' && current === patch[k]) delete patch[k]
  }

  if (!Object.keys(patch).length && !dates.value) {
    return { value: null, rejected: rejected.length ? rejected : [`${id}: nothing would change.`] }
  }

  return {
    value: {
      kind: 'update',
      id: known.id,
      patch,
      dates: dates.value,
      rationale: str(raw.rationale),
    },
    rejected,
  }
}

/** Validate a proposed new issue. `client` must be one we already know about. */
export function validateCreate(
  raw: Record<string, unknown>,
  index: IssueIndexEntry[],
  cfg: ChatConfig = DEFAULT_CHAT_CONFIG,
): Validated<CreateProposal> {
  const rejected: string[] = []
  const subject = str(raw.subject)
  if (!subject) return { value: null, rejected: ['A new issue needs a subject.'] }

  const clients = [...new Set(index.map((e) => e.client))]
  const wanted = str(raw.client)
  const client = clients.find((c) => c.toLowerCase() === wanted.toLowerCase())
  if (!client) {
    return {
      value: null,
      rejected: [
        `“${wanted || '(none given)'}” is not a client in this workspace. Known clients: ${clients.join(', ')}.`,
      ],
    }
  }

  const modules = [...new Set(index.filter((e) => e.client === client).map((e) => e.module))]
  const wantedMod = str(raw.module)
  // An unrecognised process area is not fatal: the workspace files the issue under the client
  // and says so on the card, which is better than refusing to capture the issue at all.
  const module = modules.find((m) => m.toLowerCase() === wantedMod.toLowerCase()) ?? ''
  if (wantedMod && !module) {
    rejected.push(`“${wantedMod}” is not a known process area for ${client}; it will be filed under the client.`)
  }

  const fields = cleanFields((raw.fields as Record<string, unknown>) ?? {}, 'New issue', enumsFor(cfg))
  rejected.push(...fields.rejected)
  const dates = cleanDates(raw.planned_start, raw.planned_end, 'New issue')
  rejected.push(...dates.rejected)

  const draft: Record<string, string> = { ...(fields.value ?? {}), name: subject }
  // `create` takes the subject as `name`; `subject` inside the draft would be ignored.
  delete draft.subject
  // Only carry a description when there is one — an empty key would render as a blank row on
  // the card, which reads as "this field is being cleared".
  const description = str(raw.description) || draft.description || ''
  if (description) draft.description = description
  else delete draft.description
  if (dates.value) {
    draft.plannedStart = dates.value.start
    draft.plannedEnd = dates.value.end
  }

  return {
    value: { kind: 'create', client, module, draft, rationale: str(raw.rationale) },
    rejected,
  }
}

/* ================================================================== *
 * Search
 * ================================================================== */

export interface SearchArgs {
  text?: string
  status?: string
  severity?: string
  owner?: string
  module?: string
  client?: string
  health?: string
  limit?: number
}

const norm = (s: string) => s.toLowerCase()

/**
 * Words too short or too common to carry meaning as a substring. Without this, "all" matches
 * inside "install" and "at" matches inside "reconciliation" — so a query of pure filler
 * returns a confident-looking list of unrelated issues.
 */
const STOPWORDS = new Set([
  'the', 'and', 'all', 'any', 'for', 'with', 'that', 'this', 'are', 'was', 'not', 'has',
  'issue', 'issues', 'ticket', 'tickets', 'please', 'show', 'list', 'find', 'about', 'from',
  'what', 'which', 'who', 'when', 'where', 'there', 'have', 'been', 'need', 'needs', 'get',
])

function usefulTerms(text: string): string[] {
  return norm(text)
    .split(/[\s,]+/)
    .map((t) => t.replace(/^[^a-z0-9-]+|[^a-z0-9-]+$/g, ''))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
}

/**
 * Deterministic ranked search. Exact id match wins outright, then id prefix, then subject,
 * then everything else — so "OAPIL-010" never returns a pile of loosely related rows above
 * the issue the user named.
 *
 * Text that reduces to nothing useful ("show me all of them") is treated as no text
 * constraint rather than as a query that matched nothing, so the facet filters still work.
 */
export function searchIndex(index: IssueIndexEntry[], args: SearchArgs): IssueIndexEntry[] {
  const limit = Math.min(Math.max(args.limit ?? 12, 1), 50)
  const terms = usefulTerms(args.text ?? '')

  const facet = (want: string | undefined, have: string): boolean =>
    !want || want === 'All' || norm(have).includes(norm(want))

  const scored: { e: IssueIndexEntry; score: number }[] = []
  for (const e of index) {
    if (!facet(args.status, e.status)) continue
    if (!facet(args.severity, e.severity)) continue
    if (!facet(args.owner, e.owner)) continue
    if (!facet(args.module, e.module)) continue
    if (!facet(args.client, e.client)) continue
    if (!facet(args.health, e.health)) continue

    if (!terms.length) {
      scored.push({ e, score: 1 })
      continue
    }
    let score = 0
    for (const t of terms) {
      if (norm(e.id) === t) score += 100
      else if (norm(e.id).startsWith(t)) score += 40
      else if (norm(e.id).includes(t)) score += 20
      if (norm(e.subject).includes(t)) score += 10
      if (norm(e.module).includes(t)) score += 4
      if (norm(e.owner).includes(t)) score += 3
      if (norm(e.nextAction).includes(t)) score += 2
      if (norm(e.status).includes(t)) score += 2
    }
    if (score > 0) scored.push({ e, score })
  }

  scored.sort((a, b) => b.score - a.score || a.e.id.localeCompare(b.e.id))
  return scored.slice(0, limit).map((s) => s.e)
}

export function describe(e: IssueIndexEntry): string {
  const due = e.plannedEnd
    ? `${e.plannedStart ? `${e.plannedStart} → ` : 'due '}${e.plannedEnd}`
    : 'no target date'
  return `${e.id} — ${e.subject} · ${e.client}/${e.module} · ${e.status} · ${e.severity} · ${e.owner} · ${e.health} · ${due}`
}

/* ================================================================== *
 * Offline engine
 * ================================================================== */

/** Case-insensitive lookup of a value against a closed vocabulary. */
function matchEnum(field: string, value: string, enums: Record<string, readonly string[]>): string | null {
  const allowed = enums[field]
  if (!allowed) return value
  const hit = allowed.find((a) => norm(a) === norm(value))
  return hit ?? null
}

const FIELD_ALIASES: Record<string, PatchableField> = {
  status: 'status',
  state: 'status',
  severity: 'severity',
  priority: 'severity',
  owner: 'owner',
  assignee: 'owner',
  accountable: 'accountable',
  next: 'nextAction',
  nextaction: 'nextAction',
  'next action': 'nextAction',
  subject: 'subject',
  title: 'subject',
  description: 'description',
  type: 'type',
}

const ID_RE = /\b([A-Z]{2,10}-\d{1,4})\b/i

/**
 * The engine that answers when no API key is configured.
 *
 * It is not a language model and does not pretend to be one: it handles the structured
 * phrasings the grid itself would accept, and says plainly when it cannot parse something.
 * That is more useful than an error, and it keeps the box honest about what it is doing.
 */
export function offlineReply(
  messages: ChatMessage[],
  index: IssueIndexEntry[],
  today: string,
  cfg: ChatConfig = DEFAULT_CHAT_CONFIG,
): ChatReply {
  const enums = enumsFor(cfg)
  const raw = (messages.filter((m) => m.role === 'user').pop()?.content ?? '').trim()
  const reply = (text: string, extra: Partial<ChatReply> = {}): ChatReply => ({
    text,
    matches: [],
    proposals: [],
    engine: 'offline',
    rejected: [],
    ...extra,
  })

  if (!raw)
    return reply(
      canPropose(cfg)
        ? 'Ask me to find an issue, log a new one, or change one.'
        : 'Ask me to find an issue. I am configured to answer only — I cannot draft changes here.',
    )

  /**
   * The agent registry decides whether drafting a change is on the table at all.
   *
   * Enforced here rather than only in the UI: the autonomy setting is a policy about what the
   * assistant may do, and a policy that only hides a button is not a policy.
   */
  const looksLikeMutation =
    /^(?:new|create|log|raise|add)\s+(?:an?\s+)?(?:issue|ticket)\b/i.test(raw) ||
    (ID_RE.test(raw) && /[=:]/.test(raw))
  if (looksLikeMutation && !canPropose(cfg)) {
    return reply(
      `I am set to ${cfg.autonomy === 'suggest' ? 'suggest only' : 'off'} in this workspace, so I cannot draft that change. Raise it from the tree, or change the Workspace Assistant's autonomy in Configuration.`,
    )
  }

  /* ---- create: "new issue in OAPIL/Inventory: <subject>" ---- */
  const create = raw.match(/^(?:new|create|log|raise|add)\s+(?:an?\s+)?(?:issue|ticket)\b(.*)$/i)
  if (create) {
    let rest = create[1].trim().replace(/^(?:for|in|under)\s+/i, '')
    let client = ''
    let module = ''
    const scope = rest.match(/^([A-Za-z0-9 &._-]+?)\s*\/\s*([A-Za-z0-9 &._-]+?)\s*[:\-–]\s*(.+)$/)
    if (scope) {
      client = scope[1].trim()
      module = scope[2].trim()
      rest = scope[3].trim()
    } else {
      const colon = rest.match(/^(?:([A-Za-z0-9 &._-]+?)\s*)?[:\-–]\s*(.+)$/)
      if (colon) {
        client = (colon[1] ?? '').trim()
        rest = colon[2].trim()
      }
    }
    const subject = rest.replace(/^["']|["']$/g, '').trim()
    if (!subject) {
      return reply(
        'I need a subject. Try: `new issue OAPIL/Inventory: GRN posting fails for partial receipts`.',
      )
    }
    const clients = [...new Set(index.map((e) => e.client))]
    if (!client) client = clients[0] ?? ''
    const v = validateCreate(
      { client, module, subject, rationale: 'Parsed from your message.' },
      index,
      cfg,
    )
    if (!v.value) {
      return reply(
        `I could not place that issue.\n${v.rejected.join('\n')}\nTry: \`new issue ${clients[0] ?? 'CLIENT'}/<process area>: <subject>\`.`,
        { rejected: v.rejected },
      )
    }
    return reply(
      `Ready to log a new issue under ${v.value.client}${v.value.module ? `/${v.value.module}` : ''}. Review it below and apply if it looks right.`,
      { proposals: [v.value], rejected: v.rejected },
    )
  }

  /* ---- update: "OAPIL-010 status = In Progress, owner = Priya" ---- */
  const idHit = raw.match(ID_RE)
  if (idHit && /[=:]/.test(raw)) {
    const id = idHit[1].toUpperCase()
    const after = raw.slice(raw.toUpperCase().indexOf(id) + id.length)
    const fields: Record<string, string> = {}
    const unknown: string[] = []
    let start = ''
    let end = ''

    for (const clause of after.split(/[,;]|\band\b/i)) {
      const m = clause.match(/([A-Za-z ]+?)\s*[=:]\s*(.+)$/)
      if (!m) continue
      const key = norm(m[1].trim())
      const value = m[2].trim().replace(/^["']|["']$/g, '')
      if (!value) continue
      if (/^(due|target|end|plannedend)$/.test(key.replace(/\s+/g, ''))) {
        end = value
        continue
      }
      if (/^(start|plannedstart)$/.test(key.replace(/\s+/g, ''))) {
        start = value
        continue
      }
      const field = FIELD_ALIASES[key] ?? FIELD_ALIASES[key.replace(/\s+/g, '')]
      if (!field) {
        unknown.push(`I do not know the field “${m[1].trim()}”.`)
        continue
      }
      const resolved = matchEnum(field, value, enums)
      if (resolved == null) {
        unknown.push(`“${value}” is not a valid ${field}. Allowed: ${enums[field].join(', ')}.`)
        continue
      }
      fields[field] = resolved
    }

    // `setDates` takes a range, so a bare due date needs a start. Keep the one the issue
    // already has — rewriting a recorded start to today just because the user moved the due
    // date would lose information nobody asked to change.
    if (end && !start) {
      const known = index.find((e) => e.id === id)
      start = known?.plannedStart && known.plannedStart <= end ? known.plannedStart : today
    }

    const v = validateUpdate(
      { issue_id: id, fields, planned_start: start, planned_end: end, rationale: 'Parsed from your message.' },
      index,
      cfg,
    )
    const notes = [...unknown, ...v.rejected]
    if (!v.value) {
      return reply(
        `I could not build a change for ${id}.\n${notes.join('\n') || 'Nothing in your message named a field I can set.'}`,
        { rejected: notes, matches: index.some((e) => e.id === id) ? [id] : [] },
      )
    }
    return reply(
      `Here is the change to ${v.value.id}. Nothing is saved until you apply it.${notes.length ? `\n\nI skipped: ${notes.join(' ')}` : ''}`,
      { proposals: [v.value], matches: [v.value.id], rejected: notes },
    )
  }

  /* ---- otherwise: search ---- */
  const query = raw.replace(/^(?:find|search|show|list|look\s+up|get)\s+/i, '')
  const hits = searchIndex(index, { text: query })
  if (!hits.length) {
    return reply(
      `Nothing matched “${query}”. I search issue ids, subjects, process areas, owners, statuses and next actions.`,
    )
  }
  const head = hits.length === 1 ? 'One match:' : `${hits.length} matches:`
  return reply(`${head}\n${hits.map((h) => `• ${describe(h)}`).join('\n')}`, {
    matches: hits.map((h) => h.id),
  })
}

/* ================================================================== *
 * Prompt
 * ================================================================== */

/**
 * Facet lists rather than the catalogue itself. The model needs the vocabulary to build good
 * search arguments and legal field values; it does not need 179 rows in context when it has a
 * search tool that reads them server-side.
 */
export function systemPrompt(
  index: IssueIndexEntry[],
  today: string,
  cfg: ChatConfig = DEFAULT_CHAT_CONFIG,
): string {
  const uniq = (f: (e: IssueIndexEntry) => string) =>
    [...new Set(index.map(f).filter(Boolean))].sort()
  const modules = uniq((e) => `${e.client}/${e.module}`)
  const owners = uniq((e) => e.owner)
  const t = cfg.terms
  const mayPropose = canPropose(cfg)

  const tools = mayPropose
    ? `- \`find_issues\` — search the log. Use it before answering any question about what exists, what is open, who owns what, or what is overdue. Never answer from memory: the log changes, and you only see it through this tool.
- \`propose_update\` — describe a change to an existing ${t.issue.toLowerCase()}.
- \`propose_new_issue\` — describe a ${t.issue.toLowerCase()} that should be logged.`
    : `- \`find_issues\` — search the log. It is your only tool and your only view of the data. Never answer from memory.`

  const limits = mayPropose
    ? `You never save anything. Both proposal tools only draw a card in the user's chat; the user reads it and clicks Apply, and the application makes the change through its normal audited path. Say so plainly — "here is the change, apply it if it looks right" — and never claim something has been updated or created.

You cannot delete, archive, move, or link records, or change dependencies. If asked, say that those are done from the tree and offer to find the record instead.`
    : `This workspace has you configured to answer only. You cannot draft or apply any change — not to a ${t.issue.toLowerCase()}, not to a schedule, not to anything. If the user asks for a change, say plainly that you are set to answer only here, tell them they can do it from the tree, and offer to find the record. Do not describe the change you *would* make: a description the user cannot act on reads as a change that happened.`

  return `You are the assistant inside Axiomate TMS, a delivery-management workspace. You help one user work with the ${t.issue.toLowerCase()} log.

Today is ${today}.

## The words this workspace uses
This organisation configures its own terminology, and these are its current terms. Use them exactly; do not substitute a synonym you find more natural.
- a record of work is called a **${t.issue}**
- the person driving one to resolution is the **${t.owner}**
- the organisation answerable for it is the **${t.accountable}**
- whoever reported it is the **${t.raisedBy}**
- a grouping of work within a ${t.organization.toLowerCase()} is a **${t.module}**

## What you can do
${tools}

## What you cannot do
${limits}
${
  mayPropose
    ? `
## Calling the proposal tools
Call a proposal tool once per change. After it returns, write one or two sentences telling the user what the card contains and what it would change. Do not call it again for the same change.
`
    : ''
}
If the user's request is ambiguous about which record they mean, search first and ask which one rather than guessing. If they name one that does not exist, say so.

## Values you must respect
- status: ${ISSUE_STATUSES.join(' | ')}
- severity: ${SEVERITIES.join(' | ')}
- ${t.accountable.toLowerCase()}: ${(cfg.parties.length ? cfg.parties : ACCOUNTABLE).join(' | ')}
Anything outside these lists is rejected before it reaches the user, so use them exactly.

Dates are \`YYYY-MM-DD\`. A schedule change needs both a start and an end.

${t.organization}s and ${t.module.toLowerCase()}s in this workspace: ${modules.join(', ') || '(none)'}.
Known ${t.owner.toLowerCase()}s: ${owners.join(', ') || '(none)'}.

## Style
Be brief and concrete. This is an operational tool, not a chat product: answer the question, cite record ids, and stop. Do not restate the user's request back to them, and do not narrate which tool you are about to call.`
}

/** Tool schemas. Shared so the route and any future surface describe the same contract. */
export const TOOL_SCHEMAS = {
  find_issues: {
    type: 'object' as const,
    properties: {
      text: { type: 'string', description: 'Free text matched against issue id, subject, process area, owner, status and next action.' },
      status: { type: 'string', description: `Exact status filter. One of: ${ISSUE_STATUSES.join(', ')}.` },
      severity: { type: 'string', description: `Exact severity filter: ${SEVERITIES.join(', ')}.` },
      owner: { type: 'string', description: 'Owner name or fragment of it.' },
      module: { type: 'string', description: 'Process area name or fragment of it.' },
      client: { type: 'string', description: 'Client code, e.g. OAPIL or SLG.' },
      health: {
        type: 'string',
        description: 'Schedule health: On Track, At Risk, Overdue, Blocked, Completed or Unscheduled.',
      },
      limit: { type: 'integer', description: 'Maximum rows to return (1-50, default 12).' },
    },
    required: [] as string[],
  },
  propose_update: {
    type: 'object' as const,
    properties: {
      issue_id: { type: 'string', description: 'The issue to change, e.g. OAPIL-010. It must already exist.' },
      fields: {
        type: 'object',
        description: 'Fields to change. Only status, severity, owner, accountable, nextAction, subject, description and type are accepted.',
        properties: {
          status: { type: 'string' },
          severity: { type: 'string' },
          owner: { type: 'string' },
          accountable: { type: 'string' },
          nextAction: { type: 'string' },
          subject: { type: 'string' },
          description: { type: 'string' },
          type: { type: 'string' },
        },
      },
      planned_start: { type: 'string', description: 'New planned start, YYYY-MM-DD. Required if planned_end is given.' },
      planned_end: { type: 'string', description: 'New planned end, YYYY-MM-DD. Required if planned_start is given.' },
      rationale: { type: 'string', description: 'One short sentence explaining why, shown on the card.' },
    },
    required: ['issue_id'],
  },
  propose_new_issue: {
    type: 'object' as const,
    properties: {
      client: { type: 'string', description: 'Client this issue belongs to. Must be one already in the workspace.' },
      module: { type: 'string', description: 'Process area within that client, if known.' },
      subject: { type: 'string', description: 'One-line subject.' },
      description: { type: 'string', description: 'Fuller description of the problem.' },
      fields: {
        type: 'object',
        description: 'Optional initial values.',
        properties: {
          severity: { type: 'string' },
          status: { type: 'string' },
          owner: { type: 'string' },
          accountable: { type: 'string' },
          type: { type: 'string' },
          nextAction: { type: 'string' },
        },
      },
      planned_start: { type: 'string', description: 'Planned start, YYYY-MM-DD.' },
      planned_end: { type: 'string', description: 'Planned end, YYYY-MM-DD.' },
      rationale: { type: 'string', description: 'One short sentence explaining why, shown on the card.' },
    },
    required: ['client', 'subject'],
  },
}

export type IssueStatusValue = IssueStatus
