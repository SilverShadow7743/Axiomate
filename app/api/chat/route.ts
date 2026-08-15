/**
 * Assistant endpoint.
 *
 * Two engines behind one contract:
 *   - Claude, when ANTHROPIC_API_KEY is set. Runs a tool loop over `find_issues` and the two
 *     proposal tools.
 *   - A deterministic parser, when it is not. Handles structured phrasings so the box does
 *     something useful rather than erroring, and says which engine answered.
 *
 * The workspace lives in the browser, so the client posts its issue catalogue with every turn
 * and `find_issues` executes here against that catalogue. The catalogue never goes into the
 * prompt — only the facet lists do — because a model that can already see all 179 rows stops
 * calling the search tool and starts answering from a stale snapshot of them.
 *
 * Nothing in this route writes to the workspace. It can only *describe* a mutation; the client
 * re-validates that description and dispatches the ordinary action.
 */

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import {
  DEFAULT_CHAT_CONFIG,
  MAX_HISTORY_TURNS,
  MAX_INDEX_ROWS,
  describe,
  offlineReply,
  searchIndex,
  systemPrompt,
  validateCreate,
  validateUpdate,
  canPropose,
  TOOL_SCHEMAS,
  type ChatConfig,
  type ChatMessage,
  type ChatReply,
  type IssueIndexEntry,
  type Proposal,
} from '@/lib/chat'

export const runtime = 'nodejs'
/** Never cached: every turn depends on the catalogue the client just posted. */
export const dynamic = 'force-dynamic'

const MODEL = 'claude-opus-5'
/** Enough headroom for adaptive thinking plus a short answer. */
const MAX_TOKENS = 4000
/** search → propose → summarise is three; the rest is slack for a follow-up search. */
const MAX_ITERATIONS = 6

/* ================================================================== *
 * Request parsing
 * ================================================================== */

interface ParsedBody {
  messages: ChatMessage[]
  index: IssueIndexEntry[]
  today: string
  config: ChatConfig
}

function parseBody(raw: unknown): ParsedBody | string {
  if (!raw || typeof raw !== 'object') return 'Malformed request.'
  const b = raw as Record<string, unknown>

  if (!Array.isArray(b.messages) || !b.messages.length) return 'No message was sent.'
  const messages: ChatMessage[] = []
  for (const m of b.messages.slice(-MAX_HISTORY_TURNS * 2)) {
    if (!m || typeof m !== 'object') continue
    const { role, content } = m as Record<string, unknown>
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue
    if (!content.trim()) continue
    messages.push({ role, content: content.slice(0, 4000) })
  }
  if (!messages.length) return 'No message was sent.'
  // The Messages API requires the conversation to open on a user turn.
  while (messages.length && messages[0].role !== 'user') messages.shift()
  if (!messages.length) return 'No message was sent.'

  if (!Array.isArray(b.index)) return 'The issue catalogue was missing.'
  if (b.index.length > MAX_INDEX_ROWS) return 'The issue catalogue is too large to send.'
  const index = b.index.filter(
    (e): e is IssueIndexEntry => !!e && typeof e === 'object' && typeof (e as IssueIndexEntry).id === 'string',
  )

  const today = typeof b.today === 'string' ? b.today : new Date().toISOString().slice(0, 10)
  return { messages, index, today, config: parseConfig(b.config) }
}

/**
 * Read the posted operating-model slice, falling back field by field.
 *
 * Autonomy is the load-bearing part: a body that omits it, or sends something unrecognised,
 * must not silently land on the most permissive setting. An unknown value is treated as
 * `suggest`, so a malformed request loses the ability to propose rather than gaining it.
 */
function parseConfig(raw: unknown): ChatConfig {
  const d = DEFAULT_CHAT_CONFIG
  if (!raw || typeof raw !== 'object') return d
  const c = raw as Record<string, unknown>
  const t = (c.terms ?? {}) as Record<string, unknown>
  const pick = (k: keyof ChatConfig['terms']) => (typeof t[k] === 'string' && t[k] ? (t[k] as string) : d.terms[k])

  const autonomyRaw = c.autonomy
  const autonomy: ChatConfig['autonomy'] =
    autonomyRaw === 'off' || autonomyRaw === 'suggest' || autonomyRaw === 'propose' || autonomyRaw === 'act'
      ? autonomyRaw
      : 'suggest'

  const parties = Array.isArray(c.parties)
    ? c.parties.filter((p): p is string => typeof p === 'string' && !!p.trim())
    : []

  // Same treatment as parties: filtered rather than trusted, and left empty when the request
  // sends nothing usable — an empty registry imposes no constraint, which is the honest
  // outcome, whereas a defaulted list would constrain against types this workspace may not have.
  const workTypes = Array.isArray(c.workTypes)
    ? c.workTypes.filter((t): t is string => typeof t === 'string' && !!t.trim())
    : []

  return {
    terms: {
      owner: pick('owner'),
      accountable: pick('accountable'),
      raisedBy: pick('raisedBy'),
      issue: pick('issue'),
      module: pick('module'),
      organization: pick('organization'),
    },
    parties: parties.length ? parties : d.parties,
    workTypes,
    autonomy,
  }
}

/* ================================================================== *
 * Route
 * ================================================================== */

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 })
  }

  const parsed = parseBody(body)
  if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 })
  const { messages, index, today, config } = parsed

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(offlineReply(messages, index, today, config) satisfies ChatReply)
  }

  try {
    return NextResponse.json(await runClaude(apiKey, messages, index, today, config))
  } catch (err) {
    return NextResponse.json({ error: explain(err) }, { status: 502 })
  }
}

/** Turn an SDK error into something a user in a chat box can act on. */
function explain(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'The configured API key was rejected. Check ANTHROPIC_API_KEY.'
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Rate limited by the API. Wait a moment and ask again.'
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the API. Check the network and try again.'
  }
  if (err instanceof Anthropic.APIError) {
    return `The API returned ${err.status ?? 'an error'}: ${err.message}`
  }
  return err instanceof Error ? err.message : 'The assistant failed unexpectedly.'
}

/* ================================================================== *
 * Claude engine
 * ================================================================== */

async function runClaude(
  apiKey: string,
  history: ChatMessage[],
  index: IssueIndexEntry[],
  today: string,
  cfg: ChatConfig,
): Promise<ChatReply> {
  const client = new Anthropic({ apiKey })
  const mayPropose = canPropose(cfg)

  const searchTool: Anthropic.Tool = {
    name: 'find_issues',
    description: `Search the ${cfg.terms.issue.toLowerCase()} log. Returns matching records with their status, severity, ${cfg.terms.owner.toLowerCase()}, ${cfg.terms.module.toLowerCase()}, schedule health and target date. Call this before answering any question about what exists in the log — it is your only view of it, and it changes.`,
    input_schema: TOOL_SCHEMAS.find_issues as Anthropic.Tool.InputSchema,
  }

  /**
   * Autonomy is enforced by what the model is *given*, not by asking it nicely.
   *
   * Below `propose`, the proposal tools are simply absent from the request: there is no
   * instruction to ignore, no jailbreak, and no path by which a card can reach the user.
   * Prompt wording still explains the limit, but the tool list is what makes it true.
   */
  const tools: Anthropic.Tool[] = !mayPropose
    ? [searchTool]
    : [
    searchTool,
    {
      name: 'propose_update',
      description:
        'Draw a card proposing a change to an existing issue. This does NOT save anything: the user reviews the card and clicks Apply, and the application makes the change through its own audited path. Call once per change, then tell the user in a sentence what the card would do.',
      input_schema: TOOL_SCHEMAS.propose_update as Anthropic.Tool.InputSchema,
    },
    {
      name: 'propose_new_issue',
      description:
        'Draw a card proposing a new issue to log. This does NOT save anything: the user reviews the card and clicks Apply. Call once per issue, then tell the user in a sentence what the card would create.',
      input_schema: TOOL_SCHEMAS.propose_new_issue as Anthropic.Tool.InputSchema,
    },
  ]


  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }))

  const proposals: Proposal[] = []
  const rejected: string[] = []
  /** Dedupe key per proposal, so a repeated call does not stack identical cards. */
  const seen = new Set<string>()
  /**
   * Hits from the most recent round of searching only. Accumulating across the whole loop
   * turns three narrowing searches into thirty-odd chips, most of them rows the model already
   * discarded.
   */
  let searchHits: string[] = []
  let text = ''
  /** Text from a mid-loop turn, used only if the loop never reaches a final answer. */
  let preamble = ''
  let truncated = false

  for (let turn = 0; turn < MAX_ITERATIONS; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Adaptive thinking with low effort: this is lookup and field extraction against a
      // small tool surface, and it sits in an interactive chat box where latency is the
      // thing the user feels.
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      system: [
        {
          type: 'text',
          text: systemPrompt(index, today, cfg),
          // Tools render before system, so one breakpoint here caches both. The facet lists
          // only move when the workspace's clients, process areas or owners change.
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools,
      messages,
    })

    if (response.stop_reason === 'refusal') {
      return {
        text: 'I was not able to answer that one. Try rephrasing, or work from the tree directly.',
        matches: [],
        proposals: [],
        engine: 'claude',
        model: response.model,
        rejected: [],
      }
    }

    // `max_tokens` caps thinking and text together, and a truncated turn carries no complete
    // tool_use — so it would otherwise fall out of the loop and be returned as if finished.
    if (response.stop_reason === 'max_tokens') truncated = true

    const turnText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')

    // A paused turn is resumed by re-sending with the assistant turn appended and nothing else.
    if (response.stop_reason === 'pause_turn') {
      if (turnText) preamble = turnText
      messages.push({ role: 'assistant', content: response.content })
      continue
    }

    const calls = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )

    // Only the turn that stops calling tools is the answer. Earlier turns routinely carry a
    // sentence of narration alongside their tool_use; concatenating those produced one bubble
    // containing the plan and the answer, which the client then posts back as history.
    if (!calls.length) {
      text = turnText || preamble
      break
    }
    if (turnText) preamble = turnText

    // Append the whole content array — thinking and tool_use blocks must survive the round trip.
    messages.push({ role: 'assistant', content: response.content })

    const results: Anthropic.ToolResultBlockParam[] = []
    /** Hits from this round only; several parallel searches in one turn still all count. */
    const roundHits: string[] = []
    for (const call of calls) {
      const input = (call.input ?? {}) as Record<string, unknown>

      if (call.name === 'find_issues') {
        const hits = searchIndex(index, {
          text: typeof input.text === 'string' ? input.text : undefined,
          status: typeof input.status === 'string' ? input.status : undefined,
          severity: typeof input.severity === 'string' ? input.severity : undefined,
          owner: typeof input.owner === 'string' ? input.owner : undefined,
          module: typeof input.module === 'string' ? input.module : undefined,
          client: typeof input.client === 'string' ? input.client : undefined,
          health: typeof input.health === 'string' ? input.health : undefined,
          limit: typeof input.limit === 'number' ? input.limit : undefined,
        })
        for (const h of hits) roundHits.push(h.id)
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: hits.length
            ? `${hits.length} of ${index.length} issues matched:\n${hits.map(describe).join('\n')}`
            : 'No issues matched those criteria.',
        })
        continue
      }

      if (call.name === 'propose_update' || call.name === 'propose_new_issue') {
        const v =
          call.name === 'propose_update'
            ? validateUpdate(input, index, cfg)
            : validateCreate(input, index, cfg)
        rejected.push(...v.rejected)

        if (!v.value) {
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            is_error: true,
            content: `No card was drawn. ${v.rejected.join(' ')} Fix the arguments or tell the user what is missing.`,
          })
          continue
        }

        const key =
          v.value.kind === 'update'
            ? `update:${v.value.id}`
            : `create:${v.value.client}/${v.value.draft.name}`
        if (seen.has(key)) {
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: 'That card is already on screen. Do not propose it again — just describe it to the user.',
          })
          continue
        }
        seen.add(key)
        proposals.push(v.value)

        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: `Card drawn and shown to the user, awaiting their confirmation. Nothing has been saved.${
            v.rejected.length ? ` Some arguments were dropped: ${v.rejected.join(' ')}` : ''
          } Now tell the user in one or two sentences what it would change.`,
        })
        continue
      }

      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        is_error: true,
        content: `Unknown tool "${call.name}".`,
      })
    }

    if (roundHits.length) searchHits = roundHits

    // All results for a turn go back in ONE user message, or parallel tool use degrades.
    messages.push({ role: 'user', content: results })
  }

  if (!text.trim()) {
    text = proposals.length
      ? 'Here is what I would change. Nothing is saved until you apply it.'
      : 'I could not put an answer together for that one.'
  }
  if (truncated) {
    text = `${text.trim()}\n\n(That answer was cut off at the length limit — ask for a narrower slice.)`
  }

  const matches = [
    ...new Set([...proposals.flatMap((p) => (p.kind === 'update' ? [p.id] : [])), ...searchHits]),
  ].slice(0, 20)

  return {
    text: text.trim(),
    matches,
    proposals,
    engine: 'claude',
    model: MODEL,
    rejected: [...new Set(rejected)],
  }
}
