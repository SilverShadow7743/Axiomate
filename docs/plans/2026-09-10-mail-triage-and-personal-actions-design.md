# Mail triage: unconfirmed issues and a private personal action list

**Status: approved, 10 September 2026.** User's direct request, arrived in pieces across a live
conversation — starting from *"checking mail I can see the subject but can't see the body"*,
resolving through several corrections into: shared-mailbox intake auto-files every new thread
straight into the tree with no review step, and there is no way to say "this isn't real project
work, just note it for myself." Not built.

## What was ruled out first, and why it matters

**Not a rendering bug.** The original complaint sounded like the I16 HTML-body iframe
(`components/InboxPanel.tsx`, `app/api/mail/message/[id]/route.ts`) was broken. It isn't — the
CSS, the fetch, the sandboxed iframe are all intact. The real complaint was about a different
screen entirely: the Mail log (`components/MailLog.tsx`), which lists every intake message but
offers no way to act on one.

**Not missing entirely.** One piece of what was asked for already exists: a person's own M365
inbox ("Your inbox") already has a full review-then-file flow — open a message, read it, then
either create a new issue under a chosen Process Area (`InboxPanel.tsx`'s `moduleNodes` picker,
labelled with project context via `n.id.split(':')[1]`) or attach it to an existing one
(`POST /api/mail/file`). Nothing new is needed there. What's actually missing is the same
capability for the **shared project mailboxes** (`IntakeMailbox`, e.g.
`OAPILCatalyst@axiocloudsolutions.com`) that `app/api/intake/route.ts` processes automatically,
and a private, org-invisible place to put things that turn out not to be trackable client work.

**A prior decision this reopens, named rather than silently overridden.** Mail log
(`docs/plans/2026-08-24-mail-log-design.md`) was deliberately built read-only: *"This design is
the narrower thing chosen over the larger one... **Not a triage tool.**"* That was the right call
in August — there was no reader yet. This design is the reopening that doc's own "what would send
this back" section anticipated in spirit, not a mistake being corrected.

## Research grounding

Three real products were checked before settling the shape, because this is a well-trodden
problem and guessing at it from scratch would have reinvented worse versions of solved patterns:

- **Hive**: converting an email to a task is a one-click action *inside the email itself* (not a
  separate triage screen), and the resulting task stays dynamically linked to the thread.
  Forwarding an email into Hive drops it, unstructured, onto the sender's own personal action
  list — no project, no approval, no ceremony.
- **Missive**: tasks live *inside* the conversation that spawned them, not as a disconnected
  object elsewhere.
- **Jira Service Management**: email becomes a real, tracked request **immediately** — nothing is
  ever held back pending review — but lands in a **queue**, a filtered to-do list agents triage,
  reassign and reclassify from. Plain Jira's mail handler (auto-create, no triage at all) is the
  cautionary example: it's the thing Axiomate already does today, and the thing this design
  fixes.

Two decisions came directly from this: **don't build a new screen** — extend the existing Mail
log's rows in place, the way Hive acts on the email itself rather than a separate triage
surface — and **don't hold issue creation back** pending review — auto-create immediately exactly
as today, flagged for triage, the way JSM's queues work. Holding creation back was the first
shape proposed and rejected: it would mean a new thread has no record at all — invisible to SLA
math, to reporting, to anyone — until a person happens to look, which is a worse failure mode than
the one being fixed.

## Shape

### 1. The pipeline does not change — it gets one marker added

A reply on an already-matched thread keeps auto-attaching exactly as today
(`matchingIssue`/`app/api/intake/route.ts`'s existing branch) — that thread was already judged to
be real work, so nothing here touches it. A brand-new (unmatched) thread still auto-creates an
issue immediately, through the same `create` action, with `classify()`'s severity/type/module
guess applied exactly as it is today — **severity, SLA due-date math, and routing are completely
untouched.** The one addition: the created issue carries a new field,

```ts
// Issue
needsTriage?: true
```

set only by this one code path, absent (not `false`) everywhere else — the same absent-means-
unrecorded convention every other optional `Issue`/`Person` field already follows. Cleared the
moment a person takes any triage action on the issue (see below).

### 2. Finding what needs triage

A new boolean filter, `triageOnly`, added to `FilterState` (`lib/types.ts`) the same way
`raidOnly` already works — a chip in the existing filter bar, not a new screen, not a new view-
switcher entry. `EMPTY_FILTERS.triageOnly = false`.

### 3. Acting on an unconfirmed issue

Three actions, surfaced wherever an unconfirmed issue is already shown (its row in Tree/Board, its
detail panel) — reusing existing mechanisms, not new ones:

- **Confirm** — clears `needsTriage` with no other change. For the case where `classify()` already
  got it right and there is nothing to correct.
- **Reclassify / reparent** — the existing move/edit actions (`updateIssue`, the existing parent-
  change action Tree drag-and-drop already uses) also clear `needsTriage` as a side effect of any
  edit — a person fixing the module or severity has, by definition, already triaged it.
- **Convert to a personal to-do** — soft-deletes the issue (`deletedAt`, the same convention every
  other removal in this codebase already uses — never a hard delete) and creates a new
  `PersonalAction` record from it. This is the one case that removes something from the org-
  visible tree entirely, which is why it is its own explicit action rather than a side effect of
  an ordinary edit.

Gated the same way `POST /api/mail/file` already gates filing: `evidence.add`, plus
`internal.view` for a scope with no project ancestor — no new permission invented.

### 4. `PersonalAction` — private, simple, on purpose

```ts
export interface PersonalAction {
  id: string
  personId: string        // the creator — also the only reader
  text: string
  dueDate?: string
  status: 'To do' | 'Done'
  sourceSubject?: string   // the originating message's subject, for context
  sourceMessageId?: string
  createdAt: string
  deletedAt: string | null
}
```

Deliberately minimal, per Hive's own "pops up on your action list" simplicity and Nishant's own
"keep it simple": due date and a to-do/done status, nothing else. **No priority, no reminder, no
notification** — named as the two pieces of structure considered and deliberately left out for a
first version, not forgotten. Visibility is `personId` match, full stop — never in any tree, any
report, any client pack, any org-level query. This is the one genuinely new entity in this
design; everything else reuses machinery that already exists.

A new personal screen, **"My to-dos"** — added to the same sidebar group as "My calendar"
(`components/AppSidebar.tsx`'s `mywork` group), which already carries the precedent phrase
"private to you." Lists the signed-in person's own `PersonalAction` rows, oldest due date first,
with a checkbox to toggle `status`.

## Non-goals

**Priority and reminders on `PersonalAction`** — considered (both came up as real options during
design) and deliberately cut for v1: due date and status cover the stated need, and a reminder
specifically would need a scheduled trigger this design doesn't otherwise require anything like.
**Assigning a queued message to a specific person** (Missive's "assign to a colleague" pattern) —
Axiomate has no existing "assign a communication to a person" concept to extend, and
`needsTriage`'s permission gate (anyone holding `evidence.add`/`internal.view` on the scope) is
enough for a first version; a real assignment/ownership layer is a separate decision. **Changing
how "Your inbox" files mail** — that flow already works and is untouched by this design.

## What would send this back to the design

- If `needsTriage` interacting with severity/SLA math turns out not to be as inert as assumed —
  the design's whole safety argument rests on the create path being byte-identical to today's,
  with the flag as the only addition; if a scenario proves an unconfirmed issue's due date or
  severity actually differs from what an equivalent confirmed issue would get, that contradicts
  this design's own core claim and needs a real answer, not a patch.
- If converting to a `PersonalAction` needs to preserve more of the original issue (attachments,
  notes, the inbound-mail record's own link) than a soft-delete-and-recreate can carry — the "one
  genuinely new entity, otherwise reuse everything" framing would need to widen.
