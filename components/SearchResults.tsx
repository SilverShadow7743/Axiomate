import type { SearchHit, SearchKind } from '@/lib/search'

/**
 * The grouped dropdown under the toolbar search box. Pure render: the parent owns the query,
 * the active index and the open action; this draws hits in a fixed group order with the
 * combobox/listbox roles the a11y gate expects (the mention-list pattern).
 *
 * Hits without an anchor (people, unfiled mail) are shown — they answer the query — but carry
 * nothing to open; Enter and click no-op on them, and their row says why.
 */

const GROUP_ORDER: SearchKind[] = ['issue', 'note', 'mail', 'document', 'person', 'meeting']
const GROUP_LABEL: Record<SearchKind, string> = {
  issue: 'Issues',
  note: 'Notes',
  mail: 'Mail',
  document: 'Documents',
  person: 'People',
  meeting: 'Meetings',
}

export default function SearchResults({
  hits,
  activeIndex,
  onOpen,
  onHover,
}: {
  hits: SearchHit[]
  activeIndex: number
  onOpen: (hit: SearchHit) => void
  onHover: (index: number) => void
}) {
  const ordered = GROUP_ORDER.flatMap((k) => hits.filter((h) => h.kind === k))

  return (
    <div className="gs-pop" id="gs-results" role="listbox" aria-label="Search results">
      {ordered.length === 0 ? (
        <p className="gs-empty">
          Nothing in issues, notes, mail, documents, people or meetings matches this.
        </p>
      ) : (
        GROUP_ORDER.map((kind) => {
          const group = ordered.filter((h) => h.kind === kind)
          if (!group.length) return null
          return (
            <div key={kind} className="gs-group">
              <div className="gs-group-label">{GROUP_LABEL[kind]}</div>
              {group.map((h) => {
                const i = ordered.indexOf(h)
                return (
                  <div
                    key={`${h.kind}-${h.id}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={i === activeIndex}
                    className={`gs-hit${i === activeIndex ? ' on' : ''}${h.anchorId ? '' : ' inert'}`}
                    onMouseDown={(e) => {
                      // preventDefault keeps focus in the input, so blur does not race the click.
                      e.preventDefault()
                      onOpen(h)
                    }}
                    onMouseEnter={() => onHover(i)}
                  >
                    <span className="gs-title">{h.title}</span>
                    <span className="gs-snippet">
                      {h.snippet.slice(0, h.matchStart)}
                      <b>{h.snippet.slice(h.matchStart, h.matchEnd)}</b>
                      {h.snippet.slice(h.matchEnd)}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })
      )}
      <p className="gs-foot">Discussion messages are server-side and not searched yet.</p>
    </div>
  )
}
