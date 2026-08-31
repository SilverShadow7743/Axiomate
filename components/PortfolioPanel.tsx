'use client'

import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from './useOverlay'
import DetailDrawer from './DetailDrawer'
import ReplanningDrawer from './ReplanningDrawer'
import { narrationFigures } from '@/lib/assist'
import { describePortfolio, portfolio, type Concern, type PortfolioLine } from '@/lib/portfolio'
import type { WorkspaceState } from '@/lib/workspace'

/**
 * Every engagement at once.
 *
 * The question this exists for is a partner's: "which of these needs me today". Until now every
 * screen showed one engagement at a time, so answering it meant opening each in turn and holding
 * the comparison in your head.
 *
 * **No traffic lights, and no score.** Each line states what is wrong as counted claims —
 * "13 blocked, 14 with no owner" — and every one of them is checkable by opening the engagement.
 * The reasoning lives in `lib/portfolio.ts`, including why a single blended number was refused:
 * a score is an argument about weights nobody can see, and the weights are the part worth
 * arguing with.
 */
export default function PortfolioPanel({
  state,
  today,
  onSelect,
  onApplyAllocation,
  onReleaseAllocation,
  onClose,
  docked = false,
}: {
  state: WorkspaceState
  today: string
  /** Select the engagement in the tree. The drawer stays open — one line is not the whole scan. */
  onSelect: (id: string) => void
  /** Automatic Resource Replanning's Apply — a real upsertAllocation edit-by-id. Optional so
   *  this panel still renders (without the capacity concern's drill-down) for a caller that
   *  hasn't wired allocation writes through. */
  onApplyAllocation?: (allocationId: string, percentage: number) => boolean
  onReleaseAllocation?: (allocationId: string) => boolean
  onClose?: () => void
  /** A first-class view in the main pane: no scrim, no trap, no Close — see MyWorkPanel. */
  docked?: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  useOverlay(rootRef, !docked, onClose)

  const lines = useMemo(() => portfolio(state, today), [state, today])

  /* Which person's capacity is open in the Replanning drawer — at most one at a time. */
  const [replanning, setReplanning] = useState<{ person: string; personId: string | null } | null>(null)

  /* E5: the figures as a story, on demand. The payload is built HERE, from the state this
   * reader already holds — redacted before it arrived — and E5A pins that it carries no
   * rates, no leave reasons, nothing clientView withholds. Zero tokens until asked. */
  const [narrating, setNarrating] = useState(false)
  const [narration, setNarration] = useState<string | null>(null)
  const narrate = async () => {
    setNarrating(true)
    setNarration(null)
    try {
      const res = await fetch('/api/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'narrate',
          figures: narrationFigures(state, today),
          modelId: state.model.agents['AGENT_WORKSPACE_ASSISTANT']?.modelId,
        }),
      })
      const data = (await res.json()) as { ok?: boolean; prose?: string; error?: string }
      setNarration(data.ok && data.prose ? data.prose : (data.error ?? 'The narration did not arrive.'))
    } catch {
      setNarration('The narration could not be fetched — the figures above are the same story, unnarrated.')
    } finally {
      setNarrating(false)
    }
  }

  const panel = (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- pointer-only dismissal; keyboard path is Escape via useOverlay */}
      {!docked && <div className="drawer-scrim" onMouseDown={onClose} />}
      <aside
        className={`evi mywork${docked ? ' docked' : ''}`}
        ref={rootRef}
        role={docked ? undefined : 'dialog'}
        aria-modal={docked ? undefined : true}
        aria-labelledby="portfolio-title"
      >
        <header className="evi-head">
          <div className="evi-head-top">
            <h2 id="portfolio-title">Portfolio</h2>
            {!docked && (
              <button className="btn ghost" onClick={onClose} aria-label="Close portfolio">
                ✕
              </button>
            )}
          </div>
          <div className="evi-sub sentence">{describePortfolio(lines)}</div>
          {lines.length > 0 && (
            <button className="btn ghost" onClick={() => void narrate()} disabled={narrating}>
              {narrating ? 'Narrating…' : 'Narrate this'}
            </button>
          )}
        </header>

        {narration && (
          <div className="panel-note" style={{ whiteSpace: 'pre-wrap' }}>
            {narration}
            <div className="prov" style={{ marginTop: 6 }}>
              AI-written; the figures below are the source.
            </div>
          </div>
        )}

        <div className="evi-list">
          {!lines.length && (
            <p className="evi-empty">
              No engagements or projects yet. They are the tier beneath a client in the tree, and
              this screen fills itself in as soon as one exists.
            </p>
          )}

          {lines.map((line) => (
            <Line key={line.nodeId} line={line} onSelect={onSelect} onOpenReplanning={setReplanning} />
          ))}
        </div>

        {lines.length > 0 && (
          <footer className="evi-foot">
            {/*
              * Says what the counts do NOT include, because a portfolio that quietly omits work
              * is worse than one that admits to it. Issues filed above the engagement tier are
              * in no engagement's figures — which is a tree problem, and naming it here is how
              * anybody finds out it exists.
              */}
            Counts cover everything beneath each engagement, at any depth. Work filed higher than
            an engagement is in none of these lines.
          </footer>
        )}
      </aside>

      {replanning && onApplyAllocation && onReleaseAllocation && (
        <DetailDrawer wide={false} onClose={() => setReplanning(null)}>
          <ReplanningDrawer
            state={state}
            today={today}
            person={replanning.person}
            personId={replanning.personId}
            onApplyAllocation={onApplyAllocation}
            onReleaseAllocation={onReleaseAllocation}
            onClose={() => setReplanning(null)}
          />
        </DetailDrawer>
      )}
    </>
  )

  if (docked) return <div className="view-dock">{panel}</div>
  return typeof document === 'undefined' ? null : createPortal(panel, document.body)
}

function Line({
  line,
  onSelect,
  onOpenReplanning,
}: {
  line: PortfolioLine
  onSelect: (id: string) => void
  onOpenReplanning: (subject: { person: string; personId: string | null }) => void
}) {
  return (
    <div className="evi-item">
      <div className="evi-item-body">
        <button
          className="btn-link mywork-title"
          onClick={() => onSelect(line.nodeId)}
          title="Open this engagement in the tree"
        >
          {line.name}
        </button>

        <div className="evi-item-meta">
          {line.client && <span>{line.client}</span>}
          {/*
            * Recorded status, or an explicit absence. `EngagementDetail` starts empty on purpose
            * and "Active" would be a guess — the one kind of wrong that reads exactly like a fact.
            */}
          <span>{line.status || 'status not recorded'}</span>
          <span className="mono">
            {line.open}/{line.issues} open
          </span>
          {line.high > 0 && <span className="mono">{line.high} High</span>}
          {line.projects > 0 && (
            <span>
              {line.projects} {line.projects === 1 ? 'project' : 'projects'} inside
            </span>
          )}
        </div>

        {line.concerns.length ? (
          <p className="zone-note needed">
            {line.concerns.map((c, i) => (
              <ConcernPhrase key={c.kind} concern={c} last={i === line.concerns.length - 1} onOpenReplanning={onOpenReplanning} />
            ))}
            .
          </p>
        ) : (
          <p className="evi-source-meta">
            Nothing overdue, blocked, unowned or gone quiet
            {line.lastActivity ? `. Last activity ${line.lastActivity}.` : ' — and nothing recorded here yet.'}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * One concern's clause. Plain text for five of the six kinds; `capacity` becomes a link when
 * it names a subject (`Concern.subjectPerson`), opening Automatic Resource Replanning for
 * exactly the person the phrase already names — no second, disagreeing "who is worst"
 * computation, and no drill-down offered for a concern that doesn't name anyone.
 */
function ConcernPhrase({
  concern,
  last,
  onOpenReplanning,
}: {
  concern: Concern
  last: boolean
  onOpenReplanning: (subject: { person: string; personId: string | null }) => void
}) {
  const body =
    concern.kind === 'capacity' && concern.subjectPerson ? (
      <button
        type="button"
        className="btn-link"
        onClick={() => onOpenReplanning({ person: concern.subjectPerson!, personId: concern.subjectPersonId ?? null })}
        title={`See ${concern.subjectPerson}'s allocations and what could change`}
      >
        {concern.phrase}
      </button>
    ) : (
      concern.phrase
    )
  return (
    <>
      {body}
      {last ? '' : ', '}
    </>
  )
}
