# Discussion mention-autocomplete and follower visibility — implementation plan

Follows `docs/plans/2026-09-12-discussion-mentions-design.md`.

**Ordering:** the server-side follower-name addition first — it touches storage-adjacent
code (`lib/db/discussion.ts`) but is a pure name-resolution add against data already
queried, checked by the existing `discussion-proof.ts` net before anything client-side
depends on it. The dropdown/keyboard wiring in `DiscussionTab.tsx` comes second and is
the step with the regression risk, since it touches the Enter key on a field that
already has a job (sending a message).

## 1. `lib/db/discussion.ts` — follower names, not just a count

`ThreadView` (`:38-45`) gains `followers: { id: string; name: string }[]`. In
`listThread` (`:79-100`), resolve each `discussionFollow` row's `personId` against
`gate.model.people` (already in scope — no new query):

```ts
followers: follows.map((f) => ({ id: f.personId, name: gate.model.people[f.personId]?.name ?? f.personId }))
```

The `!threadRow` early return (`:83`) gets `followers: []` alongside its existing
`followerCount: 0`. `followerCount` itself stays (`follows.length`) — the count and the
names are both used (a compact "3 following" plus the names on hover/expand), not one
replacing the other.

`/api/discussion`'s `GET` (`app/api/discussion/route.ts:55`) needs no change — it
already spreads `ThreadView` verbatim.

**Verified by:** `npx tsc --noEmit` clean; `npx tsx --conditions=react-server
scripts/discussion-proof.ts` still reports every existing check passing (it asserts
specific fields like `.following`/`.followerCount`, not a full-shape match, so the new
field cannot break it — confirmed by reading the proof first, not assumed).

## 2. `components/DiscussionTab.tsx` — the risky step

Two independent pieces, one commit (the second depends on the `View` type change the
first needs anyway):

**a. Render follower names.** `View` (`:37-42`) gains `followers: {id, name}[]`,
threaded from the fetch response. The header (`:230`, currently `` `${view.followerCount}
following` ``) shows the names — e.g. a title/tooltip listing them, or inline for a
small number and truncated with the count for a large one. Small, no risk beyond a
render change.

**b. The mention dropdown.** New local state:

```ts
const [mentionQuery, setMentionQuery] = useState<{ start: number; text: string } | null>(null)
const [mentionSel, setMentionSel] = useState(0)
```

On the input's `onChange`, after `setDraft`, recompute `mentionQuery` from the new value
and the cursor position (`e.target.selectionStart`): scan backward from the cursor for
an `@` with no whitespace between it and the cursor, and not itself preceded by a
word character (same shape `lib/mentions.ts`'s own match guard uses, so what triggers
the dropdown here is what would actually parse as one there — not a second, drifting
definition). `null` when no such `@` is found.

Candidates: `people.filter(p => p.name.toLowerCase().includes(mentionQuery.text.toLowerCase())).slice(0, 8)`
— substring, not `lib/mentions.ts`'s stricter prefix-exact match, because the dropdown
is a finder and always inserts the full correct name regardless of how loose the filter
was; the actual parse at send time is untouched and stays strict.

A small dropdown `<ul>` under the input, reusing `.rte-suggest-popup`/`.rte-suggest-list`/
`.rte-suggest-label` (`app/globals.css`, already styled for `RichTextExtensions.tsx`'s
identical Notes/Discussion-adjacent affordance) rather than inventing new classes for
the same visual language.

**The regression risk, named:** the input's existing `onKeyDown` (`:331-336`) sends the
message on Enter, unconditionally today. It must check `mentionQuery !== null` FIRST:
- `mentionQuery` open + `ArrowDown`/`ArrowUp`: move `mentionSel`, `preventDefault`, do
  NOT fall through to send.
- `mentionQuery` open + `Enter`: splice the selected candidate's name into `draft` at
  `mentionQuery.start` (replacing through the query text) followed by a space, close
  `mentionQuery`, `preventDefault`, do NOT send.
- `mentionQuery` open + `Escape`: close `mentionQuery`, `preventDefault`, do NOT send.
- `mentionQuery` is `null`: today's exact behaviour, unchanged — Enter sends.

Getting the ordering of this check backwards (checking `Enter` generically before
checking whether the dropdown is open) either strands the dropdown — Enter always
sends the raw `@partial` text as a real message — or, if inverted the other way,
makes it impossible to ever send a message that happens to end right after typing an
unrelated `@` the dropdown never resolved. Both are silent: neither throws, both just
produce the wrong one of "sent" or "not sent" depending on typing speed, which is
exactly why this is the step to review carefully rather than trust on first read.

**Verified by:** `npx tsc --noEmit` and `npx eslint components/DiscussionTab.tsx`
clean; then a manual pass — type `@` and a partial name, confirm the dropdown filters
live and Enter picks rather than sends; confirm Escape closes it and the draft is
untouched; confirm a message with no `@` in it still sends on Enter exactly as today;
confirm the picked name round-trips as a real mention (appears bold via
`mentionSegments` after posting, and the mentioned person's `mention`-kind preference
is respected) — the one place this plan's UI change and the untouched parsing logic
actually meet, worth checking end to end rather than assuming the seam holds.

## What would send the design back

- If substring matching in the dropdown surfaces so many candidates on a common
  fragment (e.g. "a") that it stops being useful on a large directory — the filter
  would need to require a leading-character match or a minimum query length instead.
  Not expected at this firm's directory size, but worth naming since it's the one
  design parameter chosen without a hard constraint behind it.

Not expected otherwise — this is small enough that a design-level surprise is unlikely;
the real risk is entirely in step 2's keyboard-handling correctness, already named above.
