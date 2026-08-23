# Mentions — implementation plan

**Design:** `2026-08-23-mentions-design.md` · **Date:** 2026-08-23

Ordering: the parser pure and proven before any mint reads it, then the kind and the
mints, then the render, then the deploy. No wire or storage change — `addNote` and
`updateNote` already carry the body, and the notification machinery from #5 carries the
telling.

## Steps

**1. The parser — `lib/mentions.ts` (new, LF), MN1's parser half.**
`mentionsIn(body, people: { id: string; name: string }[])` — at each `@`, the LONGEST
directory name matching case-insensitively wins; returns distinct-by-id matches with
offsets. `mentionSegments(body, people)` — alternating `{ kind: 'text' | 'mention' }`
segments from the same matches, so highlight and mint cannot disagree.
*Verify:* `npx tsc --noEmit`; the suite stays 92, 0 FAIL (no caller yet).

**2. The kind, the mints, MN1 — `lib/notifications.ts` (LF), `lib/workspace.ts` (CRLF,
python), `scripts/scenario-validation.ts` (CRLF, python).
THE STEP CARRYING THE MOST REGRESSION RISK** — it adds minting to `addNote`, the
second-most-dispatched arm in the product; a wrong loop double-pings or pings the author,
and the browser replay would mint the same ids or diverge from the server.

- `'mention'` joins `NOTIFICATION_KINDS`; `modeFor` needs NO change (unknown-kind default
  was designed for exactly this).
- `addNote`: after the note lands, `mentionsIn(body, Object.values(model.people))`,
  distinct by id, author excluded by directory id (`directoryPersonFor(model, actor)`),
  each person's `modeFor(prefs, id, 'mention')` consulted — mute skips + audit line,
  in-app mints delivered, in-app+email adds the pending email record — deterministic
  order (sorted by id) so the server replay mints the same ids the optimistic copy did.
- `updateNote`, when the patch changes `body`: `mentionsIn(next) minus mentionsIn(prev)`
  by id — only the newly named are told.
- MN1: the parser cases (multi-word, case-insensitive, longest-first with an overlapping
  short name minted into the directory, punctuation, unknown token); the mint per distinct
  person with `toId`; the author never pinged; the edit pinging only the addition; mute
  suppressing with the audit line; the no-`@` default minting nothing.
*Verify:* `npm run validate:scenarios` → 93 scenarios, 0 FAIL parsed (python, utf-8);
MN1 PASS; NP1 and W/Z still PASS.

**3. The render and the row — `components/NotesTab.tsx` (LF, Edit),
`components/Inbox.tsx` (LF, Edit), `app/globals.css` (CRLF, python).**
NotesTab renders `note-body` through `mentionSegments` with a `mention` span; the Inbox
preferences block gains "When somebody mentions me" (kind `mention`, shown to everyone).
*Verify:* `npx tsc --noEmit && npm run build`.

**4. Sweep, deploy, checklist section 29, push.**
Suite parsed, persistence 50, tenancy, attribution; clean-room release → deploy → health →
push. Checklist 29: a note naming a colleague highlights the name and lands in their bell;
self-mention silent; the pref row mutes it with the audit answer.

## Details most likely to be got wrong

- **Longest name first** — `@Nishant Sekhar` must not resolve to a person named `Nishant`;
  sort candidate names by length descending before matching at each `@`.
- **Distinct by id, author excluded by id** — name comparison would break on a rename and
  ping the author writing about themselves in the third person.
- **Deterministic mint order** — sorted by person id; the server replays the same action
  and must mint the same notification ids.
- **`updateNote` diffs by id, not by offset** — moving a name within the body is not a new
  mention.
- **`modeFor` untouched** — the unknown-kind default already covers stored prefs written
  before `mention` existed; touching it risks the #5 guard.
- **FAIL gates parse JSON** — python, utf-8 stdout.

## Commits

Step 1 alone. Step 2 alone (the risky one). Step 3 alone. Step 4 with the checklist.

## What would send the design back

- A hard error wanted on ambiguous names — surfaces at MN1 review; a different contract.
- Role mentions wanted — reopens the #5 rule that role labels are nobody's inbox.
