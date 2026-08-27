'use client'

/**
 * The Tiptap editor for descriptions and notes — the one part of the rich-content plan no
 * scenario harness can verify (docs/plans/2026-08-26-rich-content-plan.md's Step 5), so it needs
 * interactive browser verification before it is trusted, the same as every other browser-only
 * step this project has shipped.
 *
 * StarterKit ships far more than `lib/richText.ts`'s closed RichNode type carries — headings,
 * lists, blockquotes, strike, underline, links, code — every one of them disabled below rather
 * than left available and merely unused. Leaving them on would mean the editor's own schema
 * accepts a node kind `RichNode` has no case for the moment someone types "# " or pastes a
 * bulleted list; disabling them at the schema level is what keeps the closed type closed in
 * practice, not just in the type declaration.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import {
  MentionNode,
  IssueReferenceNode,
  ImageNode,
  RichEditorDataContext,
  useLiveRef,
  type RichEditorPerson,
  type RichEditorIssue,
} from './RichTextExtensions'
import { normalizeRichDoc, richDocsEqual, type RichDoc } from '@/lib/richText'

export interface RichTextEditorProps {
  value: RichDoc
  onChange: (doc: RichDoc) => void
  editable: boolean
  people: RichEditorPerson[]
  issues: RichEditorIssue[]
  /** Returns the uploaded document's id and a display name, or null (and shows its own message) on failure. */
  onUploadImage: (file: File) => Promise<{ documentId: string; alt: string } | null>
  placeholder?: string
  /** Appended to the wrapper's own class, e.g. to size it inside a specific form. */
  className?: string
}

const EXTENSIONS = [
  StarterKit.configure({
    blockquote: false,
    bulletList: false,
    code: false,
    codeBlock: false,
    hardBreak: false,
    heading: false,
    horizontalRule: false,
    link: false,
    listItem: false,
    listKeymap: false,
    orderedList: false,
    strike: false,
    underline: false,
  }),
  Table.configure({ resizable: true }),
  TableRow,
  TableCell,
  TableHeader,
  ImageNode,
]

export default function RichTextEditor({
  value,
  onChange,
  editable,
  people,
  issues,
  onUploadImage,
  placeholder,
  className,
}: RichTextEditorProps) {
  const peopleRef = useLiveRef(people)
  const issuesRef = useLiveRef(issues)
  const onUploadImageRef = useLiveRef(onUploadImage)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Rebuilt only if `placeholder` itself changes (static per usage site in practice) — the two
  // suggestion nodes read live data through the refs above, not through this closure, so the
  // editor never needs recreating (and cursor position/undo history never needs dropping) just
  // because the person or issue list changed underneath it.
  const extensions = useMemo(
    () => [
      ...EXTENSIONS,
      MentionNode.configure({ people: () => peopleRef.current }),
      IssueReferenceNode.configure({ issues: () => issuesRef.current }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
    ],
    [placeholder],
  )

  const lastEmitted = useRef<RichDoc>(value)

  const editor = useEditor({
    extensions,
    content: value,
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: 'rte-content' },
      handleDrop: (view, event) => {
        const file = event.dataTransfer?.files?.[0]
        if (!file || !file.type.startsWith('image/')) return false
        event.preventDefault()
        void insertUploadedImage(file)
        return true
      },
      handlePaste: (view, event) => {
        const file = [...(event.clipboardData?.items ?? [])]
          .find((it) => it.type.startsWith('image/'))
          ?.getAsFile()
        if (!file) return false
        event.preventDefault()
        void insertUploadedImage(file)
        return true
      },
    },
    onUpdate: ({ editor: e }) => {
      const doc = normalizeRichDoc(e.getJSON() as RichDoc)
      lastEmitted.current = doc
      onChange(doc)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // `value` is a prop, not editor-owned state — reflect an external change (switching which
  // note is open, a reload) into the editor, but never on the update this component's own
  // onChange just emitted, or every keystroke would reset the cursor to the start.
  useEffect(() => {
    if (!editor) return
    if (richDocsEqual(value, lastEmitted.current)) return
    lastEmitted.current = value
    editor.commands.setContent(value)
  }, [editor, value])

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  const insertUploadedImage = useCallback(
    async (file: File) => {
      setUploadError(null)
      const result = await onUploadImageRef.current(file)
      if (!result) {
        setUploadError('The image could not be attached. Nothing was inserted.')
        return
      }
      editor?.chain().focus().insertContent({ type: 'image', attrs: result }).run()
    },
    [editor, onUploadImageRef],
  )

  const fileInputRef = useRef<HTMLInputElement>(null)

  const contextValue = useMemo(() => ({ people, issues }), [people, issues])

  if (!editor) return null

  return (
    <RichEditorDataContext.Provider value={contextValue}>
      <div className={`rte${editable ? ' rte-editable' : ' rte-readonly'}${className ? ` ${className}` : ''}`}>
        {editable && (
          <div className="rte-toolbar">
            <button
              type="button"
              className={`rte-btn${editor.isActive('bold') ? ' on' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().toggleBold().run()}
              title="Bold"
            >
              B
            </button>
            <button
              type="button"
              className={`rte-btn rte-italic${editor.isActive('italic') ? ' on' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              title="Italic"
            >
              I
            </button>
            <span className="rte-toolbar-sep" />
            <button
              type="button"
              className="rte-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() =>
                editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()
              }
              title="Insert table"
            >
              Table
            </button>
            <button
              type="button"
              className="rte-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              title="Insert image"
            >
              Image
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="rte-file-input"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void insertUploadedImage(file)
              }}
            />
            {editor.isActive('table') && (
              <>
                <span className="rte-toolbar-sep" />
                <button type="button" className="rte-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().addRowAfter().run()} title="Add row">+Row</button>
                <button type="button" className="rte-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().addColumnAfter().run()} title="Add column">+Col</button>
                <button type="button" className="rte-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteRow().run()} title="Delete row">−Row</button>
                <button type="button" className="rte-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteColumn().run()} title="Delete column">−Col</button>
                <button type="button" className="rte-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteTable().run()} title="Delete table">Delete table</button>
              </>
            )}
          </div>
        )}
        <EditorContent editor={editor} />
        {uploadError && <div className="rte-upload-error">{uploadError}</div>}
      </div>
    </RichEditorDataContext.Provider>
  )
}
