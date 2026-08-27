# Repositioning the Assistant as a command palette

## Problem

`components/ChatPanel.tsx` is one component behind two engines. `app/api/chat/route.ts` runs
Claude in a multi-turn tool loop when `ANTHROPIC_API_KEY` is set, and `lib/chat.ts`'s
`offlineReply` — a deterministic parser — when it is not. This deployment will not have a key
(confirmed this session, see `boot().assistant.engine` and the header badge shipped as backlog
item #8). Offline is not a degraded fallback here; it is the permanent mode.

`offlineReply` is a genuine command grammar, not approximate natural language — three
verb-triggered branches (`new|create|log|raise|add issue …`, `<ID> field=value, …`, and a
bare-text fallback that is a search) with punctuation-driven syntax (`Client/Module:` scoping,
`field=value` clauses split on `,`/`;`/`and`). It is also stateless per turn: it reads
`messages.filter(m => m.role === 'user').pop()` and nothing else, so the multi-turn history a
chat log implies is decorative for this engine. The Claude engine, when live, genuinely uses
that history in a tool loop — chat framing is correct there, just not here.

`ChatPanel` today wraps this command grammar in chat furniture regardless of engine: speech
bubbles, a conversational greeting ("Ask me to find an issue, log a new one, or change one"),
a multiline composer, and a "Read replies aloud" voice toggle. Every query that doesn't match
one of the three known patterns fails or answers oddly, with the UI offering no hint toward the
phrasings that do work. This is the mismatch backlog item #10 exists to resolve: repositioning
the offline presentation to be honest about what it is, without touching the Claude path.

## Decision: `ChatPanel` becomes engine-aware, not a single reskin

`boot().assistant.engine` (`'claude' | 'offline'`) already flows to `ChatPanel` as a prop, per
item #8. The redesign branches on it: `engine === 'claude'` renders exactly what exists today,
unchanged. `engine === 'offline'` renders a new command-palette presentation. This keeps
`app/api/chat/route.ts`'s working, tested Claude path intact for any future deployment that does
set a key, rather than deleting or degrading it on the strength of this deployment's decision.

## Invocation

The palette becomes a centered overlay with a scrim, not the right-side dock `ChatPanel` uses
today — closer to `EventForm`'s `.modal-scrim`/`.modal` pattern than to the docked
`MyWorkPanel`/`TimesheetPanel` style. It is portaled to `document.body`, the same as those
panels, and uses `useOverlay` (`components/useOverlay.ts`) for focus-trap, `inert`-background,
and Escape-to-close — the same hook `MyWorkPanel`/`PortfolioPanel`/`TimesheetPanel` already use
for their non-docked instance, not a new pattern.

Two ways in: the existing "Assistant" toolbar button (`IssueWorkspace.tsx`, currently
`onClick={() => setChatOpen((v) => !v)}`) keeps its label and position — this is a reposition of
the interaction, not a rebrand, and renaming would cost discoverability for no gain. A new
`Ctrl/Cmd+K` global shortcut is added to `IssueWorkspace.tsx`'s existing keyboard effect
(`onKey`, currently handling Escape for `dialog`) as a second entry point. Both respect the
existing `assistantOffered !== 'off'` gate; `Ctrl/Cmd+K` is a no-op when the agent registry has
the assistant turned off.

Lifecycle is unchanged from today: `ChatPanel` unmounts on close (`{chatOpen && ... && (<ChatPanel
.../>)}`) and remounts fresh on reopen — no new persistence, no cross-session state.

## The command input and hints

A single-line input replaces the multiline textarea for the offline presentation. Below it, a
hint line updates live as text is typed: before typing, nothing (the syntax reference above the
input already documents the three verbs — see Onboarding below); once typing starts, which verb
the text currently reads as (`Find` / `New issue` / `Change <ID>`), or, when no verb and no
leading issue id are present, a neutral "this reads as a search" state — untagged text is the
fallback branch, not an error, and the hint should not imply one.

Two autocomplete triggers, arrow-key + Tab/Enter to accept, matching how `TreeGrid`'s inline
cell editors already behave:

1. After an uppercase-looking id fragment, suggest matching real ids from the posted `index`.
2. After `field=` where `field` is a closed-vocabulary field (`status`, `severity`, or
   `accountable` when the workspace has configured parties), suggest its legal values from
   `enumsFor(cfg)`.

Neither trigger changes what the grammar accepts — they surface values `offlineReply` would
already accept, so autocommiting a suggestion can never produce a value the engine then rejects.

## Command/result log

Kept, not replaced with a single most-recent result — restyled. Each entry shows the typed
command in monospace, REPL-prompt style, then its result: a match list, a proposal diff card, a
created-issue card, or an error/rejection list. No speech bubbles, no assistant persona in the
copy. `role="log" aria-live="polite" aria-relevant="additions text"` on the region carries over
unchanged from today's `ChatPanel`. Proposal cards keep their existing Apply/Dismiss behavior and
`apply()`/`claimed` double-submit guard verbatim — nothing about the proposal-review-before-apply
flow changes, only its container styling.

## Onboarding

The conversational greeting (`greeting()`, `ChatPanel.tsx:50`) is replaced, for the offline
presentation only, with a compact syntax reference: the three real patterns, one live example
each. `examplesFor()`'s existing example strings become clickable syntax templates that populate
the input (as they already do via `send(e)` today) rather than "example questions" — same
mechanism, corrected framing.

## Search gains real facets

`offlineReply`'s search branch currently calls `searchIndex(index, { text: query })` only — it
never parses facets, so a query like "find high severity payroll" (an existing `examplesFor()`
sample) works only by keyword-scoring luck: "high" happens to substring-match the literal string
"High" in `e.severity`. `SearchArgs`/`searchIndex` already support `status`/`severity`/`owner`/
`module`/`client`/`health` as real filters; nothing in the search branch uses that.

The update branch (`<ID> field=value, …`) already has a working `field=value` clause parser
against `FIELD_ALIASES` and `enumsFor(cfg)`. The search branch gains the same parsing, scoped to
the subset of aliases that map onto `SearchArgs` (`status`, `severity`, `owner`, `module`,
`client`) — plus `health`, which has no alias in `FIELD_ALIASES` today and needs one added
(`health`/`schedule` → `health`) since it is a `SearchArgs` facet with no `PatchableField`
equivalent. Recognized `field=value` tokens are stripped from the query and passed as facets;
whatever text remains becomes the free-text term list, exactly as today. `status=Open
severity=High` and `payroll status=Open` (mixed free text and facets) both become real filters.
This is a change to `lib/chat.ts`, reachable by both the palette UI and the raw API (the grammar
gets more capable, not just differently presented) — worth calling out explicitly since it is the
one piece of this design that is not purely presentational.

## Voice

`VoiceInput` (`components/VoiceInput.tsx`) stays, wired to the single-line input in place of the
textarea — dictating a search phrase or a new issue's subject is still useful hands-free. The
"Read replies aloud" toggle and its `speechSynthesis` call (`ChatPanel.tsx`'s `send()`, the
`speakReplies` branch) are removed for the offline presentation: reading a match list or a
field-diff aloud serves a chat product, not a command tool.

## What does not change

- `app/api/chat/route.ts`'s contract and the Claude tool loop.
- `validateUpdate`/`validateCreate` and the client-side re-validation gate before `dispatch`.
- The Claude-engine presentation in `ChatPanel` — same bubbles, same greeting, same voice/TTS
  toggle, byte-for-byte, selected only by `engine === 'claude'`.
- Item #8's `boot().assistant.engine` plumbing and header badge.
- `canPropose(cfg)`/autonomy gating — enforced the same way, in the same place
  (`offlineReply`'s `looksLikeMutation` check and `systemPrompt`'s tool list for Claude).

## What would send this back

- If the hint-line's live verb detection turns out to need its own parser rather than reusing
  `offlineReply`'s regexes directly (e.g., because the hint must update on every keystroke against
  partial, often-invalid input in a way the full parser wasn't written to tolerate) — that would
  mean either duplicating grammar logic (a real maintenance cost) or restructuring `offlineReply`
  itself to expose an incremental/partial-parse mode, which is a larger change than this design
  assumes.
- If stripping `field=value` tokens out of a search query before free-text scoring turns out to
  collide with genuine free-text terms that happen to contain a bare `=` or `:` (e.g. a subject
  line quoted verbatim) — the update branch never had to solve this because it only looks at text
  *after* a matched issue id, where the ambiguity doesn't arise.
- If `useOverlay`'s focus-trap, built for dialogs with a handful of controls, behaves badly against
  a live-updating autocomplete dropdown (e.g. Tab landing on a suggestion instead of wrapping) —
  worth confirming once actually wired up, not just reasoned about.
