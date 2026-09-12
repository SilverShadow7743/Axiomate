# Discussion mention-autocomplete and follower visibility — design

Approved by Nishant, 12 Sep 2026. Scoped down from the original ask ("increase
person-to-person collaboration") after finding the Notes composer already has full
@mention and #issue-reference autocomplete (`components/RichTextExtensions.tsx`, a real
Tiptap node built on `@tiptap/suggestion` — dropdown, keyboard nav, live-resolved names).
What Discussion (`components/DiscussionTab.tsx`) actually lacks, confirmed by reading the
component: its composer is a bare `<input>`, not Tiptap, so a person must blindly type an
exact full name with the placeholder's only guidance being "@name to summon somebody" —
no dropdown, no feedback on a typo. Two contained pieces close this gap.

## 1. Follower visibility

`lib/db/discussion.ts`'s `listThread` already queries the full follower list
(`tx.discussionFollow.findMany`) but returns only `follows.length` — the names are
discarded before the response leaves the server. `ThreadView` gains `followers: {id:
string; name: string}[]`, resolved from the same `gate.model.people` the function
already holds (no new query). `/api/discussion`'s GET spreads `ThreadView` verbatim
(`{ ok: true, ...view }`), so this reaches the client with no route change.
`DiscussionTab`'s `View` type and header render the names instead of (or alongside) the
bare count.

## 2. Discussion mention-autocomplete

Contained to `DiscussionTab.tsx` — no new shared component, since it is the only plain-text
`@mention` field in the app; Notes' equivalent is a genuinely different mechanism (a
ProseMirror node) that doesn't apply to a bare input. If a second plain-text mention field
appears later, this is the point to extract a shared one, not before.

- Track the active "@query" (start offset + typed text since the `@`) as the draft
  changes, the same detection shape `lib/mentions.ts`'s own parser uses (an `@` not
  preceded by a word character, no whitespace since).
- A dropdown positioned below the input, visually matching Notes' own
  (`.rte-suggest-popup`/`.rte-suggest-list`/`.rte-suggest-label` — the same CSS classes,
  not a new visual language for the same affordance), filtering the `people` list
  `DiscussionTab` already computes (`:205`) by substring match, capped at 8 — matching
  `buildSuggestion`'s own cap in `RichTextExtensions.tsx`.
- Keyboard: ArrowUp/Down move the highlighted candidate; Enter picks one when the dropdown
  is open — taking priority over the existing "Enter sends the message" handler on the
  input, which must check for an open dropdown first; Escape closes it without sending.
- Picking a candidate splices the full directory name into `draft` at the query's offset,
  followed by a space, and closes the dropdown. Nothing else changes: the actual
  mention-detection and notification mint (`lib/mentions.ts`'s `mentionsIn`, already
  wired into `lib/db/discussion.ts`'s `postMessage` via `recipientsFor`) is untouched —
  this is a typing aid over an existing, already-correct parse, not a change to what
  counts as a mention or who gets told.

## Risk

Low, and narrow: an additive, purely client-side UI change with no change to the
mention-parsing or notification-minting logic, both of which stay exactly as proven
today. The one place to be careful: the Enter-key interception. Getting the
dropdown-is-open check wrong either breaks sending a message (Enter always intercepted)
or breaks picking a candidate (Enter always sends) — this is the detail the
implementation plan should call out explicitly, not something to get right by accident.

## Testing

The mention-detection and notification logic this reuses is already proven elsewhere
(`lib/mentions.ts`, `lib/db/discussion.ts`'s `recipientsFor`) and untouched here, so no
new scenario is needed for that half. The dropdown/keyboard wiring itself is UI behaviour
no scenario in this codebase drives — verified by typecheck, eslint, and a manual pass,
the same limit every other click/keyboard change in this session has lived with.

## Out of scope

- Extending mention-autocomplete to any other plain-text field — none currently exists;
  Notes already has it via Tiptap.
- A broader "who's involved in this record" summary (owner + assignees + followers +
  recent mentions in one place) — speculative rather than grounded in a confirmed gap,
  and a bigger change touching FactBox/DetailPanel.
