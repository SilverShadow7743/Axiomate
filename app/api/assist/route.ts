/**
 * The assist endpoint — E5's two single-shot features behind one door.
 *
 *   - `narrate`: the Portfolio's figures in, prose out. Read-only; the proposal contract
 *     does not even engage.
 *   - `suggest-work`: a Discussion thread's messages in, a CreateProposal out — checked by
 *     `validateCreate` BEFORE the response leaves, and checked again by the client with the
 *     same gate before any card renders. Model output is untrusted input, checked twice by
 *     one rule.
 *
 * Stateless like the chat route, and that is the posture, not an omission: the client builds
 * every payload from the reader's own redacted state, so the model can only ever see what
 * the asking person may see. This route reads no stored data and resolves no tenant.
 *
 * No key is a configuration fact, not an error: 200 with `offline: true`, in words.
 */

import { NextResponse } from 'next/server'
import { getSession, identityEstablished } from '@/lib/principal'
import Anthropic from '@anthropic-ai/sdk'
import { validateCreate, type ChatConfig, type CreateProposal, type IssueIndexEntry } from '@/lib/chat'
import type { NarrationFigures, SuggestRequest } from '@/lib/assist'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_MODEL = 'claude-sonnet-5'
const MAX_TOKENS = 2000
/** A serialized payload larger than this is a client bug, not a workload. */
const MAX_BODY_CHARS = 120000

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
  return 'Something went wrong talking to the model.'
}

function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

export async function POST(req: Request) {
  const session = getSession(req)
  if (identityEstablished() && !session.verified) {
    return NextResponse.json({ ok: false, error: 'Sign in to use the assistant.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }
  if (JSON.stringify(body).length > MAX_BODY_CHARS) {
    return NextResponse.json({ ok: false, error: 'The payload is too large to send.' }, { status: 413 })
  }
  const b = body as { kind?: unknown; figures?: unknown; request?: unknown; index?: unknown; config?: unknown; modelId?: unknown }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      offline: true,
      error: 'The assistant is offline — no model key is configured. The figures on screen are the same story, unnarrated.',
    })
  }
  const client = new Anthropic({ apiKey })
  const model = typeof b.modelId === 'string' && b.modelId.trim() ? b.modelId.trim() : DEFAULT_MODEL

  if (b.kind === 'narrate') {
    const figures = b.figures as NarrationFigures | undefined
    if (!figures || typeof figures !== 'object' || !Array.isArray(figures.lines)) {
      return NextResponse.json({ ok: false, error: 'The figures were missing.' }, { status: 400 })
    }
    try {
      const response = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system:
          'You narrate delivery risk for a consulting firm from the figures provided — and ONLY from them. ' +
          'Write 2–4 short paragraphs of plain prose: lead with what most needs attention, name records and people as the figures name them, ' +
          'and never invent a number, a name or a cause the figures do not carry. If the figures say a list was truncated, say so. ' +
          'No headings, no bullet lists, no advice beyond what the figures support.',
        messages: [{ role: 'user', content: JSON.stringify(figures) }],
      })
      const prose = textOf(response)
      if (!prose) return NextResponse.json({ ok: false, error: 'The model returned nothing readable.' }, { status: 502 })
      return NextResponse.json({ ok: true, prose, model: response.model })
    } catch (err) {
      return NextResponse.json({ ok: false, error: explain(err) }, { status: 502 })
    }
  }

  if (b.kind === 'suggest-work') {
    const request = b.request as SuggestRequest | undefined
    if (!request || typeof request !== 'object' || !Array.isArray(request.messages) || !request.messages.length) {
      return NextResponse.json({ ok: false, error: 'The thread was missing.' }, { status: 400 })
    }
    const index = (Array.isArray(b.index) ? b.index : []).filter(
      (e): e is IssueIndexEntry => !!e && typeof e === 'object' && typeof (e as IssueIndexEntry).id === 'string',
    )
    const config = (b.config ?? undefined) as ChatConfig | undefined
    try {
      const response = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system:
          'A consulting team discussed something in the thread provided; draft the work item it points at. ' +
          'Answer with ONE JSON object and nothing else: {"subject": string (short, imperative), "client": string, ' +
          '"description": string (what and why, grounded only in the thread), "fields": {"severity"?: string, "type"?: string}, ' +
          '"rationale": string (one sentence: why this thread is a work item)}. ' +
          'The scope context names where the discussion happened — prefer its client. Do not invent facts the thread does not carry.',
        messages: [{ role: 'user', content: JSON.stringify(request) }],
      })
      const raw = textOf(response)
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(raw.replace(/^```json?\s*|```\s*$/g, '')) as Record<string, unknown>
      } catch {
        return NextResponse.json({ ok: false, error: 'The model did not answer in the agreed shape. Try again.' }, { status: 502 })
      }
      /* The same gate the client will run again — checked here first so a bad draft never
       * even travels. */
      const checked = validateCreate(parsed, index, config)
      if (!checked.value) {
        return NextResponse.json({ ok: false, error: checked.rejected.join(' ') || 'The draft did not survive validation.' }, { status: 502 })
      }
      const proposal: CreateProposal = checked.value
      return NextResponse.json({ ok: true, proposal, rejected: checked.rejected, model: response.model })
    } catch (err) {
      return NextResponse.json({ ok: false, error: explain(err) }, { status: 502 })
    }
  }

  return NextResponse.json({ ok: false, error: 'Unrecognised request.' }, { status: 400 })
}
