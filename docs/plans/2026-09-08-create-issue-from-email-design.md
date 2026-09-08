# Turning one read email into an issue, on purpose

**Status: draft, 8 September 2026.** User's direct request — *"create actions from it"* (from
mail). Not built.

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
