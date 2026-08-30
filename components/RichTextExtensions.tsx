'use client'

/**
 * The three node kinds `lib/richText.ts`'s closed type carries that Tiptap does not ship:
 * `mention`, `issueReference`, `image`.
 *
 * All three are atoms (no editable content inside) rendered through a React NodeView, and all
 * three resolve what they display live, at render time, from `RichEditorDataContext` — never
 * from an attribute baked in at save time. A stored mention or reference is only ever a bare id
 * (`personId`, `issueId`); the name and the live status shown for it can change after the note
 * was written, and the design's own reasoning for `@mention` (lib/mentions.ts) is the reasoning
 * here too: a cached copy of a fact that changes is a copy that goes wrong.
 *
 * `image` deliberately does not use `@tiptap/extension-image`'s node shape (`src`/`title`/
 * `width`/`height`) — the design keeps an embedded image as a reference into the existing
 * Document/upload pipeline (`documentId`), not a raw URL, so it stays visible in the issue's own
 * Documents list too, and so `/api/documents/[id]`'s access check (never a bare, cookie-free URL
 * in the page payload) still applies to every view of it.
 */

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, ReactRenderer, type NodeViewProps } from '@tiptap/react'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion'

export interface RichEditorPerson {
  id: string
  name: string
}

export interface RichEditorIssue {
  id: string
  subject: string
  status: string
}

/**
 * Live data for resolving a mention or a reference at render time. Supplied by whichever screen
 * hosts the editor (`OverviewTab`, `NotesTab`) from the same `WorkspaceState` it already holds —
 * this context exists so the three node views below do not each need their own prop-drilling
 * path from the editor's own props, which Tiptap's `NodeViewRenderer` does not thread through.
 */
export const RichEditorDataContext = createContext<{
  people: RichEditorPerson[]
  issues: RichEditorIssue[]
}>({ people: [], issues: [] })

/* ================================================================== *
 * Suggestion popup — shared by the @ and # triggers
 * ================================================================== */

interface SuggestionItem {
  id: string
  label: string
  sub?: string
}

interface SuggestionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

function SuggestionList({
  items,
  command,
  handleRef,
}: {
  items: SuggestionItem[]
  command: (item: SuggestionItem) => void
  handleRef: (h: SuggestionListHandle) => void
}) {
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    setSelected(0)
  }, [items])

  useEffect(() => {
    handleRef({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowDown') {
          setSelected((i) => (items.length ? (i + 1) % items.length : 0))
          return true
        }
        if (event.key === 'ArrowUp') {
          setSelected((i) => (items.length ? (i - 1 + items.length) % items.length : 0))
          return true
        }
        if (event.key === 'Enter') {
          if (items[selected]) command(items[selected])
          return true
        }
        if (event.key === 'Escape') return true
        return false
      },
    })
    // Re-registered every render so the handler closes over the current `selected`/`items`.
  })

  if (!items.length) {
    return <div className="rte-suggest-empty">No matches</div>
  }

  return (
    <ul className="rte-suggest-list" role="listbox">
      {items.map((item, i) => (
        <li
          key={item.id}
          role="option"
          aria-selected={i === selected}
          className={i === selected ? 'on' : ''}
          onMouseDown={(e) => {
            e.preventDefault()
            command(item)
          }}
          onMouseEnter={() => setSelected(i)}
        >
          <span className="rte-suggest-label">{item.label}</span>
          {item.sub && <span className="rte-suggest-sub">{item.sub}</span>}
        </li>
      ))}
    </ul>
  )
}

/**
 * Wires a `@tiptap/suggestion` config to a `SuggestionList` popup. `search` maps the live query
 * text to candidates; `pick` turns a chosen candidate into the node the caller's `command`
 * inserts. Shared by both triggers below rather than duplicated, since the popup mechanics —
 * position from `clientRect`, keyboard nav, click-to-pick, teardown on exit — do not depend on
 * what is being searched.
 */
function buildSuggestion<T extends SuggestionItem>(
  char: string,
  pluginKey: string,
  search: (query: string) => T[],
  pick: (item: T, range: { from: number; to: number }, editor: import('@tiptap/core').Editor) => void,
): Omit<SuggestionOptions, 'editor'> {
  return {
    char,
    pluginKey: new PluginKey(pluginKey),
    items: ({ query }: { query: string }) => search(query).slice(0, 8),
    command: ({ editor, range, props }) => {
      pick(props as T, range, editor)
    },
    render: () => {
      let renderer: ReactRenderer<SuggestionListHandle> | null = null
      let handle: SuggestionListHandle | null = null
      let popup: HTMLElement | null = null

      const position = (rect: DOMRect | null) => {
        if (!popup || !rect) return
        popup.style.left = `${rect.left + window.scrollX}px`
        popup.style.top = `${rect.bottom + window.scrollY + 4}px`
      }

      return {
        onStart: (props) => {
          popup = document.createElement('div')
          popup.className = 'rte-suggest-popup'
          document.body.appendChild(popup)
          renderer = new ReactRenderer(SuggestionList, {
            props: {
              items: search(props.query),
              command: (item: SuggestionItem) => pick(item as T, props.range, props.editor),
              handleRef: (h: SuggestionListHandle) => {
                handle = h
              },
            },
            editor: props.editor,
          })
          popup.appendChild(renderer.element)
          position(props.clientRect?.() ?? null)
        },
        onUpdate: (props) => {
          renderer?.updateProps({
            items: search(props.query),
            command: (item: SuggestionItem) => pick(item as T, props.range, props.editor),
            handleRef: (h: SuggestionListHandle) => {
              handle = h
            },
          })
          position(props.clientRect?.() ?? null)
        },
        onKeyDown: (props) => {
          if (props.event.key === 'Escape') {
            popup?.remove()
            renderer?.destroy()
            return true
          }
          return handle?.onKeyDown({ event: props.event }) ?? false
        },
        onExit: () => {
          popup?.remove()
          renderer?.destroy()
          popup = null
          renderer = null
        },
      }
    },
  }
}

/* ================================================================== *
 * mention
 * ================================================================== */

function MentionView({ node }: NodeViewProps) {
  const { people } = useContext(RichEditorDataContext)
  const personId = node.attrs.personId as string
  const person = people.find((p) => p.id === personId)
  return (
    <NodeViewWrapper as="span" className="note-mention rte-chip">
      @{person?.name ?? 'someone'}
    </NodeViewWrapper>
  )
}

export const MentionNode = Node.create<{ people: () => RichEditorPerson[] }>({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  addOptions() {
    return { people: () => [] }
  },
  addAttributes() {
    return { personId: { default: null } }
  },
  parseHTML() {
    return [{ tag: 'span[data-mention-id]', getAttrs: (el) => ({ personId: (el as HTMLElement).getAttribute('data-mention-id') }) }]
  },
  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-mention-id': node.attrs.personId }), `@${node.attrs.personId}`]
  },
  addNodeView() {
    return ReactNodeViewRenderer(MentionView)
  },
  addProseMirrorPlugins() {
    const options = this.options
    return [
      Suggestion({
        editor: this.editor,
        ...buildSuggestion(
          '@',
          'mentionSuggestion',
          (query) =>
            options
              .people()
              .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
              .map((p) => ({ id: p.id, label: p.name })),
          (item, range, editor) => {
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                { type: 'mention', attrs: { personId: item.id } },
                { type: 'text', text: ' ' },
              ])
              .run()
          },
        ),
      }),
    ]
  },
})

/* ================================================================== *
 * issueReference
 * ================================================================== */

function IssueReferenceView({ node }: NodeViewProps) {
  const { issues } = useContext(RichEditorDataContext)
  const issueId = node.attrs.issueId as string
  const issue = issues.find((i) => i.id === issueId)
  return (
    <NodeViewWrapper as="span" className="rte-chip rte-issue-ref">
      {issueId}
      {issue && <span className="rte-issue-ref-status">{issue.status}</span>}
    </NodeViewWrapper>
  )
}

export const IssueReferenceNode = Node.create<{ issues: () => RichEditorIssue[] }>({
  name: 'issueReference',
  group: 'inline',
  inline: true,
  atom: true,
  addOptions() {
    return { issues: () => [] }
  },
  addAttributes() {
    return { issueId: { default: null } }
  },
  parseHTML() {
    return [{ tag: 'span[data-issue-ref]', getAttrs: (el) => ({ issueId: (el as HTMLElement).getAttribute('data-issue-ref') }) }]
  },
  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-issue-ref': node.attrs.issueId }), `#${node.attrs.issueId}`]
  },
  addNodeView() {
    return ReactNodeViewRenderer(IssueReferenceView)
  },
  addProseMirrorPlugins() {
    const options = this.options
    return [
      Suggestion({
        editor: this.editor,
        ...buildSuggestion(
          '#',
          'issueReferenceSuggestion',
          (query) =>
            options
              .issues()
              .filter(
                (i) =>
                  i.id.toLowerCase().includes(query.toLowerCase()) ||
                  i.subject.toLowerCase().includes(query.toLowerCase()),
              )
              .map((i) => ({ id: i.id, label: i.id, sub: i.subject })),
          (item, range, editor) => {
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                { type: 'issueReference', attrs: { issueId: item.id } },
                { type: 'text', text: ' ' },
              ])
              .run()
          },
        ),
      }),
    ]
  },
})

/* ================================================================== *
 * image
 * ================================================================== */

function ImageView({ node }: NodeViewProps) {
  const documentId = node.attrs.documentId as string
  const alt = node.attrs.alt as string | null
  return (
    <NodeViewWrapper as="span" className="rte-image-wrap">
      {/* Served through the authenticated /api/documents route, not a static asset
          next/image can optimise — a plain img is the right element here. */}
      <img src={`/api/documents/${documentId}`} alt={alt ?? 'attachment'} className="rte-image" />
    </NodeViewWrapper>
  )
}

export const ImageNode = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      documentId: { default: null },
      alt: { default: null },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-image-document-id]',
        getAttrs: (el) => ({
          documentId: (el as HTMLElement).getAttribute('data-image-document-id'),
          alt: (el as HTMLElement).getAttribute('data-alt'),
        }),
      },
    ]
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-image-document-id': node.attrs.documentId,
        'data-alt': node.attrs.alt,
      }),
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  },
})

/**
 * A mutable box for the suggestion callbacks above — `items()` is called imperatively by
 * ProseMirror outside React's render cycle, so it cannot read a prop or a piece of state
 * directly. The editor component keeps this in sync with the latest `people`/`issues` via
 * `useEffect` on every render; reading `.current` here always sees the latest values without
 * needing to recreate the editor (which would drop cursor position and undo history) whenever
 * the workspace changes underneath it.
 */
export function useLiveRef<T>(value: T) {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}
