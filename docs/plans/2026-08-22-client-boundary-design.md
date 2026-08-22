# Client-safe visibility boundary — design

Remediation #2 of the register (22 Aug 2026). Awaiting approval. The last prerequisite before
guest access, and the fix for scenario RP2's P1: nothing marks a record or note as safe for a
client, so every client pack is assembled by hand and internal notes sit one copy-paste from
the client.

## The rule in one sentence

**What a client may see is decided per record, by a person, and enforced by withholding from
the payload — never by a screen declining to render.** The `rate.view` precedent, applied to
content: `boot()` already removes rates from what leaves the server for anyone without the
grant, and this design extends that posture to records, notes and documents.

## The permission is inverted on purpose

The new key is `internal.view` — *"See internal records and notes. Without it, only what has
been deliberately marked client-visible leaves the server."* Every internal role holds it in
the shipped grants; the three client roles (Sponsor, Lead, User) do not, and it joins the
internal-only set that external role types can never be granted. Inverting it (a
`client.limited` flag on roles) was rejected: a permission that *removes* sight is a negative
grant, and the access model has no negatives — absence of a key is the only "no" it speaks.

Stated consequence, same as every new key: stored roles hold it only after `lostInMerge`
surfaces it and somebody grants it — EXCEPT that withholding must fail SAFE before that
happens. So the redaction rule is: withhold **unless** the actor's verdict for
`internal.view` is allowed. A workspace that has not yet granted the key shows internal
users a boundary-limited view until the grant lands — annoying and loud, never leaky.
(In practice the Permissions screen grant is step one of the checklist, as it was for
`mail.send` and `document.review`.)

## The flag

`clientVisible: boolean` on **IssueRecord**, **IssueNote** and **DocumentRecord** — the three
things a client-facing surface would show. Default **false**: nothing becomes visible except
by a person's decision. Two principled exceptions at creation:

- A record created by a **client-role actor** (their own request) is born visible — hiding
  someone's own submission from them would be absurd.
- A record created by **intake** (mail or form) is born visible for the same reason: the
  claimed sender is the client, and the guest phase will show them their own requests.

Notes and documents have no exceptions: replies TO the client (the phase-5 compose's pinned
note) are marked visible by that arm explicitly; everything else stays internal until marked.

## Who marks, and where

Setting the flag requires `work.edit` (records), the note author or `note.editAny` (notes),
`document.upload` (documents) — no new permission for marking, because marking is editing.
Surfaces: a "Client-visible" toggle chip on the record's field strip area (Overview), a
checkbox beside Pin on the note composer, and a per-document toggle in the Evidence drawer.
Everything marked renders a small `client-visible` chip wherever it appears, so what the
client can see is legible to internal eyes at a glance — the boundary is a feature, not a
secret.

## What withholding covers

For an actor without `internal.view`, `boot()`'s `publish` step delivers:

- `issues`: only `clientVisible` records; the TREE keeps the ancestor nodes of visible
  records (a record without its place is unreadable) and drops branches with nothing visible.
- `notes`: only `clientVisible` notes on visible records.
- `documents` / `evidence`: only flagged documents, and evidence rows whose record is visible
  (evidence descriptions are internal-workmanship by default — a flagged document travels,
  its evidence row's note does not unless the record is visible and the row's document is
  flagged).
- `audit`: entries whose `rowId` is a visible record, and only field changes — reasons are
  kept (they are the client-facing story), but entries about internal records vanish.
- `rates`, `personSkills`, `estimates`, `timeEntries`, `timesheets`, `allocations`,
  `commitments`, `changes`, `sows`, `milestones`: withheld wholesale — commercial and
  people machinery is not client content even when a record is visible. (Milestone
  acceptance in the guest phase will get its own deliberate surface, not the raw table.)
- Counts and summaries recompute over the delivered subset — the sign-in gate's lesson:
  withholding the records and shipping the summary of them is the same disclosure.

## What this phase does NOT build

No guest sign-in, no client workspace UI, no weekly pack — those are the guest phase and the
reports phase, both of which consume this boundary. This phase ships the flag, the grant,
the withholding, and the internal marking surfaces, proven by scenario and by reading the
actual payload an unprivileged actor receives.

## Storage

Additive migration: `clientVisible Boolean @default(false)` on Issue, IssueNote, Document.
Mapper pairs extend. The persistence proof adds a round trip and — the one that matters — a
**payload proof**: `publish()` for a keyless actor contains no unmarked record, note,
document, rate, or audit line, checked from the serialized output.

## Testing

Scenario CB1, pure: defaults (internal creation → false; client-role creation → true; intake
creation → true); marking flips with the right permission and refuses without; the phase-5
compose's note is born visible; `publish` for a keyless actor withholds the unmarked and
keeps the marked with its ancestors; counts agree with the delivered subset. CP1's
capability count moves 21 → 22 (`clientBoundary`, needs `['internal.view']`) in the same
commit as the catalogue entry.

## What would send this back

- The tree cannot keep ancestors without leaking sibling structure a client should not see
  (surfaces at the publish step) — the boundary would need a projected tree, not a filtered
  one.
- "Born visible for intake" proves wrong for a firm whose intake carries internal mail too
  (surfaces in review) — the default would move to the mailbox/form configuration instead of
  the arm.
- Fail-safe withholding before the grant lands proves unworkable for the single-operator
  deployment mode (surfaces in step 2) — the open-deployment posture would need an explicit
  carve-out, stated on screen.
