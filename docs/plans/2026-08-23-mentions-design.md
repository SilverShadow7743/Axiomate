# Mentions — design

**Date:** 2026-08-23 · **Register item:** #8 · **Status:** approved (batch go)

## The gap

Notes are the working record, but naming a colleague in one tells them nothing. The PRD's
contextual-linking rule wants a person named in a note to know they were named — without a
new channel, a new table, or a new permission.

## The design

A mention is **`@` followed by a directory person's name**, matched case-insensitively and
longest-name-first (so `@Nishant Sekhar` resolves to the person, not to a one-word prefix
of somebody else). No new storage: the note body IS the record; the notification machinery
built for #5 carries the telling.

### 1. The pure parser — `lib/mentions.ts` (new)

`mentionsIn(body, people)` → distinct `{ id, name, start, length }` matches. Longest name
wins at each `@`; a token matching nobody is plain text; punctuation directly after a name
does not break the match; matching is on the directory NAME as written, case-insensitive.
`mentionSegments(body, people)` → alternating text/mention segments for rendering — the
same parser, so the highlight can never disagree with the mint.

### 2. The kind and the mint

`'mention'` joins `NOTIFICATION_KINDS` — `modeFor` already answers `in-app` for a kind
nobody has chosen, so existing prefs degrade correctly by design. In `addNote`: mint one
in-app notification per DISTINCT mentioned person (ruleId `mention`, toId from the
directory match, subject naming the record, body an excerpt), never to the author
themselves, each person's own preference consulted exactly as the other mints do — mute
skips the record and writes the audit line, `in-app+email` queues the email record for the
drain. In `updateNote`, when the body changes: only mentions NEW in the next body mint —
an edit that keeps a name does not re-ping it.

### 3. The screens

- **NotesTab**: note bodies render through `mentionSegments`, mentions wrapped in a
  `mention` span — the highlight and the mint share one parser.
- **Inbox preferences**: a fourth row, "When somebody mentions me".

### 4. Proof

Scenario **MN1**: the parser (multi-word name, case-insensitive, longest-first against an
overlapping shorter name, punctuation after the name, an unknown token ignored); `addNote`
minting per distinct person with `toId` set and never to the author; `updateNote` minting
only the newly added name; the mute preference suppressing with the audit line; the
default path — a note with no `@` minting nothing new.

## Out of scope, stated

- **A composer picker** (type-ahead @-completion) — a UI convenience over the same parser,
  worth its own small pass; the mention works today by typing the name.
- **Mentions in descriptions or other fields** — notes are where people talk.
- **Role mentions** (`@Delivery Lead`) — role labels are nobody's inbox (the #5 rule).

## What would send this back

- Ambiguous-name policy disputed (two people, same name — the parser matches the name; the
  directory join returns null id and no mint, silently): if a firm wants a hard error
  instead, that is a different contract, and it surfaces at MN1 review.
