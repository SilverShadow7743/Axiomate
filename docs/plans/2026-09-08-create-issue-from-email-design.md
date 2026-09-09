# Turning one read email into an issue, on purpose

**Status: closed, 9 September 2026 — see "What this design missed" below.** User's direct
request — *"create actions from it"* (from mail). Originally drafted 8 September 2026.
Reconciled the same day the classification gap was fixed; the review-dialog question below was
put to the user, who answered **"instant create"** — the existing one-click filing behaviour is
kept as-is, no dialog added. Nothing further to build; this design is superseded by
`2026-08-31-in-mail-design.md`'s already-shipped filing feature, now correctly classified.

## What this design missed

This draft was written without checking whether mail-filing already existed. It already did —
`2026-08-31-in-mail-design.md`'s "File-to-issue", built more than a week before this draft, is a
"File as work item" action on `InboxPanel.tsx` (`POST /api/mail/file`, `mode: 'create'` →
`lib/mailFile.ts`'s `mapGraphMessage`) that creates an issue directly from an opened message —
the exact trigger this design proposes a *second* "Create issue…" button for. Building this
design as written would have put two create-from-this-message buttons on the same panel.

The real gap, found while reconciling: `mapGraphMessage` didn't classify at all — it hardcoded
`type: 'Request'` and `severity: 'Medium'` on every filed mail, an invented default this repo's
own operating principle 2 rules out. **That half is fixed** (9 Sept): `mapGraphMessage` now
calls `draftFor` (`lib/intake.ts`) — the same rule-matching and severity/type guessing routed
mail already gets — instead of the two constants. Not `classify`: `classify` resolves a mailbox
from `message.to`, and a personal inbox's `to` is the filer's own address, essentially never a
configured shared intake mailbox, so it would refuse `no-mailbox` for nearly every message filed
this way — a gap in classification-reuse this draft's own "What would send this back" section
did not anticipate, because it assumed `classify` would be the entry point. `draftFor` is called
directly with the parent scope the person already chose in the filing dialog, sidestepping the
mailbox lookup entirely — the same pattern `classifyForm` already uses for the intake form's own
non-mailbox entry point.

**Decided**: this draft's other half — routing the create through the "Add Work" dialog for
review instead of creating immediately — was put to the user as a real UX change to a shipped
feature (one click becomes two). Answer: **keep instant create**. `provenanceNote` is already
attached via `recordInboundMail`'s honest-provenance fields (`mailbox`, `from`, `subject`,
`body`, `messageId`) regardless of which way that question went —
it was never missing, just under a different name than this draft assumed.

## What exists today, and why this is the safer direction, not a repeat

Automatic mailbox intake already exists (`lib/intake.ts`'s `classify`/`draftFor`, wired to a
Logic App reading a shared mailbox) — but I2d's own finding is a caution, not a precedent to
extend blindly: `INBOX_62` produced 27 issues in one day from one address, most of them
newsletters and out-of-office replies, before it was stopped. That failure mode is *too much*
automatic creation from noise nobody chose.

What's being asked here is the opposite shape: a **manual, per-message, person-initiated**
action — "I am looking at this one email right now and I want it to become an issue." A human
already decided this specific message matters before anything is created. That is a materially
safer trigger than a mailbox-wide automatic filter, not a second version of the same risk.

## Shape

A "Create issue…" button on an opened message in `InboxPanel.tsx` (natural pairing with the
full-body-view design, `2026-09-08-email-body-view-design.md` — this reuses that fetch, and
needs the real body, not the `bodyPreview` snippet, to classify well).

Reuses the classification this codebase already has, rather than inventing a second one:

```
InboundMessage { to, from, subject, body: htmlToText(fullBody), messageId, receivedAt, conversationId }
  → classify(...)   // lib/intake.ts, already used by automatic intake
  → draftFor(...)   // → IntakeDraft: subject, severity, work type guess, process area guess
```

The draft **pre-fills the existing "Add Work" dialog** (the same one `+ New Issue` already opens)
rather than creating anything directly — the person reviews and edits before anything is
committed, the same review step every other manual issue-creation path already has. Nothing new
is auto-created; classification only saves typing.

`provenanceNote(message, draft)` (already exported from `lib/intake.ts`, already used by
automatic intake to record where a record came from) attaches the same way here — the created
issue's provenance says it came from this email, identically to one that arrived through the
automatic pipeline. One provenance shape, not two.

## What this deliberately does not do

**Does not touch the automatic intake pipeline** — no shared code path is modified, no mailbox
configuration changes; this is a second, independent entry point into the same
`classify`/`draftFor`/`provenanceNote` functions, callable from a person's own inbox instead of
from the Logic App. **Does not auto-create** — see above; the dialog always opens for review, even
when classification is confident. **Does not thread replies back**: creating an issue from a
message does not change how that message's later replies get matched to the issue (that is
`docs/plans/2026-08-25-intake-reply-threading-design.md`'s concern, built for the automatic
pipeline's `conversationId` matching, and not touched here) — a manually created issue starts
clean, without assuming this pattern extends there for free.

## Dependency

This needs `2026-09-08-email-body-view-design.md` built first (or alongside) — `classify` works
on `htmlToText(body)`, and today's `bodyPreview` snippet is too truncated to classify anything
past a one-line email reliably. Sequencing this after that design is a dependency, not a
preference.

## Non-goals

Bulk "create issues from these N selected emails" — the request is about one email at a time;
introduces exactly the batch-noise risk I2d already got burned by. Attachment filing onto the
created issue — the original `in-mail` design's own non-goal (documents consent), unchanged here.

## What would send this back

If `classify`'s confidence on real personal-inbox email (versus the shared-mailbox traffic it was
tuned against) turns out poor enough that the pre-filled draft is more often wrong than right,
the pre-fill either narrows to just subject + provenance (dropping severity/work-type guessing)
or the button becomes "start a blank issue, provenance attached" instead of a classified one —
a scope-down, not a blocker, and something only real use against a real inbox will show.
