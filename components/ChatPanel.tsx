'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatConfig, ChatMessage, ChatReply, IssueIndexEntry, Proposal } from '@/lib/chat'
import { canPropose, validateCreate, validateUpdate } from '@/lib/chat'
import { speakableReply } from '@/lib/voice'
import VoiceInput from './VoiceInput'

/**
 * The assistant dock.
 *
 * It is a docked panel rather than a modal on purpose: finding an issue and changing one are
 * things you do *while* looking at the tree, and a dialog that covers the tree would hide the
 * very rows the answer is about. Nothing here traps focus or makes the shell inert.
 *
 * The panel never mutates the workspace. It renders proposals as cards; applying one calls
 * back into the workspace, which re-validates and dispatches the ordinary audited action.
 */

export interface ApplyOutcome {
  ok: boolean
  message: string
}

interface Props {
  index: IssueIndexEntry[]
  today: string
  /** Which engine will answer, decided server-side from ANTHROPIC_API_KEY — shown in the
   *  header so the mode is known before a query is typed, not disclosed only in a reply. */
  engine: ChatReply['engine']
  /** The operating-model slice the assistant runs under. */
  config: ChatConfig
  /** Select a row and make sure it is actually visible (expanded, not filtered away). */
  onReveal: (id: string) => void
  onApply: (proposal: Proposal) => ApplyOutcome
  onClose: () => void
}

type CardState = 'pending' | 'applied' | 'dismissed' | 'failed'

interface Turn {
  id: number
  role: 'user' | 'assistant'
  text: string
  matches: string[]
  proposals: Proposal[]
  rejected: string[]
  engine?: ChatReply['engine']
  error?: boolean
}

/** The opening line states what this assistant may actually do here, not what one could do. */
function greeting(cfg: ChatConfig): Turn {
  const noun = cfg.terms.issue.toLowerCase()
  return {
    id: 0,
    role: 'assistant',
    text: canPropose(cfg)
      ? `Ask me to find ${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}, log a new one, or change one.\n\nI never save anything myself — I show you the change and you apply it.`
      : `Ask me to find ${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}.\n\nI am configured to answer only in this workspace, so I cannot draft changes.`,
    matches: [],
    proposals: [],
    rejected: [],
  }
}

function examplesFor(cfg: ChatConfig): string[] {
  const find = ['find overdue inventory issues', 'find high severity payroll']
  return canPropose(cfg)
    ? ['find overdue inventory issues', 'OAPIL-010 status = In Progress', 'new issue OAPIL/Inventory: GRN posting fails']
    : find
}

/** "Status: Open → In Progress" lines, so the card shows the change rather than the result. */
function diffLines(p: Proposal, index: IssueIndexEntry[]): { label: string; from: string; to: string }[] {
  const label = (k: string) =>
    k === 'nextAction' ? 'Next action' : k.charAt(0).toUpperCase() + k.slice(1)

  if (p.kind === 'update') {
    const current = index.find((e) => e.id === p.id)
    const out = Object.entries(p.patch).map(([k, v]) => ({
      label: label(k),
      from: String((current as unknown as Record<string, unknown> | undefined)?.[k] ?? '—'),
      to: v,
    }))
    if (p.dates) {
      out.push({
        label: 'Planned dates',
        from:
          current?.plannedStart && current?.plannedEnd
            ? `${current.plannedStart} → ${current.plannedEnd}`
            : 'not scheduled',
        to: `${p.dates.start} → ${p.dates.end}`,
      })
    }
    return out
  }

  return Object.entries(p.draft)
    .filter(([k, v]) => k !== 'name' && v)
    .map(([k, v]) => ({ label: label(k), from: '—', to: v }))
}

export default function ChatPanel({ index, today, engine, config, onReveal, onApply, onClose }: Props) {
  const [turns, setTurns] = useState<Turn[]>(() => [greeting(config)])
  const [draft, setDraft] = useState('')
  /**
   * Whether to read replies aloud.
   *
   * Held here rather than in the voice control because the reply arrives here — and it is
   * session state rather than a stored preference, since it is a fact about the room somebody
   * is sitting in today.
   */
  const [speakReplies, setSpeakReplies] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cards, setCards] = useState<Record<string, CardState>>({})

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const seq = useRef(1)
  /** Guards against a reply landing after the panel closed. */
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, busy])

  const send = useCallback(
    async (raw: string) => {
      const question = raw.trim()
      if (!question || busy) return

      const mine: Turn = {
        id: seq.current++,
        role: 'user',
        text: question,
        matches: [],
        proposals: [],
        rejected: [],
      }
      // Read the history off the state we are about to commit, so the request carries this
      // turn without waiting for a re-render.
      const history: ChatMessage[] = [...turns, mine]
        .filter((t) => t.id !== 0 && !t.error)
        .map((t) => ({ role: t.role, content: t.text }))

      setTurns((prev) => [...prev, mine])
      setDraft('')
      setBusy(true)

      const fail = (msg: string) =>
        setTurns((prev) => [
          ...prev,
          { id: seq.current++, role: 'assistant', text: msg, matches: [], proposals: [], rejected: [], error: true },
        ])

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages: history, index, today, config }),
        })
        const data = (await res.json()) as ChatReply & { error?: string }
        if (!alive.current) return

        if (!res.ok || data.error) {
          fail(data.error || `The assistant is unavailable (${res.status}).`)
          return
        }

        // The response body is model output. Re-validate every proposal here, on the client,
        // immediately before it can reach a dispatch — the reducer does not runtime-check
        // enums, because until now every write came from a <select>.
        const safe: Proposal[] = []
        const dropped: string[] = [...(data.rejected ?? [])]
        for (const p of data.proposals ?? []) {
          const v =
            p.kind === 'update'
              ? validateUpdate(
                  {
                    issue_id: p.id,
                    fields: p.patch,
                    planned_start: p.dates?.start,
                    planned_end: p.dates?.end,
                    rationale: p.rationale,
                  },
                  index,
                  config,
                )
              : validateCreate(
                  {
                    client: p.client,
                    module: p.module,
                    subject: p.draft.name,
                    description: p.draft.description,
                    fields: Object.fromEntries(
                      Object.entries(p.draft).filter(
                        ([k]) => k !== 'name' && k !== 'description' && !k.startsWith('planned'),
                      ),
                    ),
                    planned_start: p.draft.plannedStart,
                    planned_end: p.draft.plannedEnd,
                    rationale: p.rationale,
                  },
                  index,
                  config,
                )
          dropped.push(...v.rejected)
          if (v.value) safe.push(v.value)
        }

        setTurns((prev) => [
          ...prev,
          {
            id: seq.current++,
            role: 'assistant',
            text: data.text,
            matches: data.matches ?? [],
            proposals: safe,
            rejected: [...new Set(dropped)],
            engine: data.engine,
          },
        ])

        /**
         * Read it back, if asked to.
         *
         * Proposals are announced as a count rather than read out field by field: a spoken list
         * of changed fields is unlistenable, and the person has to look at the cards to accept
         * them anyway. Saying how many there are tells them to look.
         */
        if (speakReplies && typeof window !== 'undefined' && window.speechSynthesis) {
          window.speechSynthesis.cancel()
          window.speechSynthesis.speak(
            new SpeechSynthesisUtterance(speakableReply(data.text, safe.length)),
          )
        }
      } catch {
        if (alive.current) fail('Could not reach the assistant. Check that the app server is running.')
      } finally {
        if (alive.current) setBusy(false)
      }
    },
    [busy, turns, index, today, config, speakReplies],
  )

  /**
   * Claimed keys live in a ref, not in `cards`. Two clicks inside one tick both read the same
   * pre-render `cards` object, so a state-based guard lets the second one through — and a
   * second create would mint a second issue with a fresh id that nothing downstream would
   * recognise as a duplicate.
   */
  const claimed = useRef<Set<string>>(new Set())

  const apply = useCallback(
    (key: string, p: Proposal) => {
      if (claimed.current.has(key)) return
      claimed.current.add(key)
      setCards((c) => ({ ...c, [key]: 'applied' }))
      const res = onApply(p)
      if (!res.ok) setCards((c) => ({ ...c, [key]: 'failed' }))
    },
    [onApply],
  )

  return (
    <aside className="chat" aria-label="Assistant">
      <header className="chat-head">
        <span className="chat-title">Assistant</span>
        <span
          className={`chat-mode-badge ${engine}`}
          title={
            engine === 'offline'
              ? 'No ANTHROPIC_API_KEY is configured — structured phrasings only, no language model.'
              : 'Answered by Claude.'
          }
        >
          {engine === 'offline' ? 'Structured mode' : 'Claude'}
        </span>
        <span className="grow" />
        <button className="btn ghost chat-x" onClick={onClose} aria-label="Close the assistant">
          ×
        </button>
      </header>

      <div className="chat-log" ref={scrollRef} role="log" aria-live="polite" aria-relevant="additions text">
        {turns.map((t) => (
          <div key={t.id} className={`chat-turn ${t.role}${t.error ? ' error' : ''}`}>
            <div className="chat-bubble">{t.text}</div>

            {t.engine === 'offline' && (
              <p className="chat-engine">
                Answered without the language model — no <code>ANTHROPIC_API_KEY</code> is configured, so
                structured phrasings only.
              </p>
            )}

            {t.matches.length > 0 && (
              <div className="chat-chips">
                {t.matches.map((id) => (
                  <button key={id} className="chat-chip" onClick={() => onReveal(id)} title="Show in the tree">
                    {id}
                  </button>
                ))}
              </div>
            )}

            {t.proposals.map((p, i) => {
              const key = `${t.id}:${i}`
              const state = cards[key] ?? 'pending'
              const lines = diffLines(p, index)
              return (
                <div key={key} className={`chat-card ${state}`}>
                  <div className="chat-card-head">
                    <span className="chat-card-kind">
                      {p.kind === 'update' ? `Change ${p.id}` : 'Log a new issue'}
                    </span>
                    {p.kind === 'create' && (
                      <span className="chat-card-where">
                        {p.client}
                        {p.module ? ` / ${p.module}` : ' / unfiled'}
                      </span>
                    )}
                  </div>

                  {p.kind === 'create' && <p className="chat-card-subject">{p.draft.name}</p>}

                  {lines.length > 0 && (
                    <dl className="chat-diff">
                      {lines.map((l) => (
                        <div key={l.label}>
                          <dt>{l.label}</dt>
                          <dd>
                            {p.kind === 'update' && <s>{l.from}</s>}
                            <b>{l.to}</b>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  {p.rationale && <p className="chat-card-why">{p.rationale}</p>}

                  {state === 'pending' ? (
                    <div className="chat-card-actions">
                      <button className="btn primary" onClick={() => apply(key, p)}>
                        Apply
                      </button>
                      <button
                        className="btn"
                        onClick={() => setCards((c) => ({ ...c, [key]: 'dismissed' }))}
                      >
                        Dismiss
                      </button>
                    </div>
                  ) : (
                    <p className="chat-card-state">
                      {state === 'applied'
                        ? 'Applied — see the History tab for the audit entry.'
                        : state === 'failed'
                          ? 'Not applied — the workspace rejected it.'
                          : 'Dismissed.'}
                    </p>
                  )}
                </div>
              )
            })}

            {t.rejected.length > 0 && (
              <ul className="chat-rejected">
                {t.rejected.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        ))}

        {turns.length === 1 && (
          <div className="chat-examples">
            {examplesFor(config).map((e) => (
              <button key={e} className="chat-example" onClick={() => send(e)}>
                {e}
              </button>
            ))}
          </div>
        )}

        {busy && <div className="chat-turn assistant"><div className="chat-bubble thinking">Working…</div></div>}
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault()
          void send(draft)
        }}
      >
        <label className="sr-only" htmlFor="chat-draft">
          Message the assistant
        </label>
        <textarea
          id="chat-draft"
          ref={inputRef}
          rows={2}
          value={draft}
          placeholder={canPropose(config) ? `Find, log, or change ${/^[aeiou]/i.test(config.terms.issue) ? 'an' : 'a'} ${config.terms.issue.toLowerCase()}…` : `Find ${/^[aeiou]/i.test(config.terms.issue) ? 'an' : 'a'} ${config.terms.issue.toLowerCase()}…`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send(draft)
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
        <button className="btn primary" type="submit" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>

      {/* Voice sits under the composer, not in place of it: it produces text for the same
          route, and every proposal it leads to is still a card somebody accepts. */}
      <VoiceInput
        disabled={busy}
        onSpeakChange={setSpeakReplies}
        onTranscript={(text) => {
          setDraft(text)
          void send(text)
        }}
      />
    
    </aside>
  )
}
