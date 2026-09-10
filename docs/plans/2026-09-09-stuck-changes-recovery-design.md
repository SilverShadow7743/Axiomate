# Stuck-changes recovery — design

**Status:** design approved by Nishant, 9 September 2026. Built and live-verified against
production (SLG-001) on 9–10 September 2026 — see the "Data flow" and "Open question" updates
below, added after implementation surfaced one real gap the original design missed.

## Why this exists

Production incident, same day: Nishant and Tarun both reported edits — and newly created
issues — that appeared to save but were gone after a reload. Traced live (see the "Tier 2"
session history in this repo's commit log for 9 Sep, and `2026-09-09-issue-workspace-redesign-design.md`
is unrelated — this incident happened alongside that work, not as part of it):

- This app's autosave queue (`components/useAutosave.ts`, `lib/queue.ts`) checks every write
  against the field values the browser last read (`lib/workspace.ts:2650-2674`'s `expected`
  mechanism) and refuses with a 409 if the server has since changed. That check is already
  correctly narrow — it compares only the fields a given action actually touches, not a whole
  row version, specifically so that (per its own comment) *"two people working the same record
  at once are stopped when they genuinely disagree and left alone when they do not."*
- What is NOT narrow: on a 409, the client queue halts entirely (`lib/queue.ts`'s `Halt: 'stopped'`)
  and the server's own batch fold (`lib/db/persist.ts:203-227`) `break`s on the first rejected
  action rather than continuing past it. Every action queued after the conflict — on that
  record or any other — silently stops reaching the server until the page reloads, at which
  point everything since the halt is discarded (the queue lives only in memory).
- The only warning was a small corner badge (`.persist-tag`, `components/IssueWorkspace.tsx`)
  whose full explanation sat behind a hover tooltip. A same-day fix (commit `9e03d34`) makes
  the halt fire a loud, 15-second toast the moment it happens, reusing the existing toast
  system (`notify`, `components/IssueWorkspace.tsx`) and the detail text that was already
  written (`describeSaveDetail`, `lib/autosave.ts`) but never surfaced proactively. That fix is
  live. It does not recover anything that is already stuck, and does not survive a reload — it
  only makes the moment of failure hard to miss.

This document is the next piece: what happens to the stuck changes themselves.

## Options considered

Investigated three directions before designing this one (full findings: a background
investigation run the same day, cited inline below where it found something specific):

**A. Persist the stuck queue + a recovery panel (this design).** Additive — writes each queued
action to local storage as well as memory, surfaces a plain-language list on any halt or on
reload, lets the person reapply or discard each one. Does not touch conflict detection or the
save path itself.

**B. Loosen the halt scope itself** — change the server fold to skip a rejected action instead
of stopping the batch, and have the client resume everything that was not actually stale.
Confirmed architecturally possible (the field-level `expected` check already has the precision
this would need), but it means reworking `committedKeys`, the audit-index bookkeeping and the
client's dedup logic, all in the single most safety-critical path in the app, with no scenario
coverage today for "does an unrelated sibling action survive a batch partial-failure." Rejected
for this pass — real value, but it is its own scoped project with its own test plan, not a
same-week follow-on to a production incident.

**C. Reduce collision frequency** (presence indicators, field locks). Explicitly not what
Nishant asked for — recovery matters more than prevention here — left out.

**A is what got approved.** It directly answers "when this happens, can I get my change back
without reloading and hoping," without touching the code that decides whether a write is safe.

## Architecture

A new persisted log, separate from the existing local mirror (`lib/autosave.ts`'s
`saveWorkspaceLocally`/`loadWorkspaceLocally`, which only exists for no-database installs and
holds the *whole* workspace). This one is narrow and exists whenever a database is configured:
one entry per action that has been queued but not yet confirmed by the server. Written the
moment an action is queued; removed the moment the server confirms it. So at any instant, what
this log holds *is* the accurate answer to "what is actually at risk right now" — not something
reconstructed after the fact from a count.

On load, the app checks this log for the signed-in tenant. Entries left over from a session
that ended without clearing them (reload during a halt, a crashed tab, a tab discarded by the
browser) mean unconfirmed work exists — the recovery view opens on its own.

**Revised after implementation, before this shipped further** (advisor review, then confirmed
live): "an entry exists in the log" is not by itself "this is stuck." `savePendingAction` writes
at enqueue and `clearPendingAction` at server confirmation — a real network round trip apart —
so an entry exists for the entire ordinary gap of every save, not just a genuine halt. Ending a
session inside that ordinary gap (closing a tab right after an edit) is routine, not a loss;
opening the recovery view over it would be a false alarm on a change that in fact saved fine,
training exactly the ignore-reflex the toast fix exists to avoid.

The log is now gated by a second, narrower marker: `markHalted`/`wasHalted`/`clearHalted`
(`lib/pendingActions.ts`), stamped only by `useAutosave.ts`'s `settle()` on a genuine
`Halt: 'stopped'` — never on an entry merely existing. The boot-time check opens the recovery
view only when this marker is set; a leftover entry with no recorded halt is treated as a stray
(most likely already committed via the `sendBeacon` unload flush) and cleared silently instead
of shown. The marker itself clears — via `clearPendingAction`, the one place every removal path
already funnels through — the moment the persisted log actually empties, so it cannot
misclassify a later, unrelated in-flight gap. It deliberately does *not* clear on a live tab's
in-memory queue emptying (`useAutosave.ts`'s ref, reset fresh on every mount) — that was the
first version of this fix, and live verification caught it being wrong: reapplying one of two
stuck entries drained the *current* session's queue to empty and cleared the marker, silently
discarding the second, still-unresolved entry on the next reload. See the plan's step 6 notes
for the reproduction.

## Components

- **`lib/pendingActions.ts`** (new). Same shape and conventions as the local-mirror functions
  in `lib/autosave.ts` — tenant-namespaced storage key, JSON-serialised, the same graceful
  fallback `saveWorkspaceLocally` already has for a blocked or full quota (return `{ok: false}`,
  never throw). Exports `savePendingAction`, `clearPendingAction`, `loadPendingActions(tenantId)`.
- **`components/useAutosave.ts`** (existing, small addition). Calls `savePendingAction` at the
  same point an action joins the in-memory queue; calls `clearPendingAction` at the same point
  a 200 confirms it. No change to `verdictFor`, `shouldResume`, or the drain loop itself.
- **A recovery view** (new component, name TBD at implementation time). Renders each stuck
  action using the same plain-language shape the audit log already uses for a settled one
  (`AuditEntry`'s `rowId`/`field`/`from`/`to`, `lib/types.ts:176-182`, rendered today by
  `History` in `components/DetailPanel.tsx`) — so a stuck change reads exactly like any other
  change in this app, not like raw queued data. Two actions per item: **Reapply** (re-dispatch
  the same edit against current state — a fresh `dispatch`, not a raw resend, so a real conflict
  gets checked properly) and **Discard** (drop it, no longer wanted, no dispatch).

## Data flow

1. An edit dispatches → local state updates immediately (unchanged) → the action is queued for
   the server *and* written to the pending-actions log.
2. Server confirms (200) → cleared from the log. The common case, invisible, unchanged from today.
3. Server refuses (409) → today's toast fires immediately (already shipped). The pending log
   already holds an accurate list of everything still stuck — the recovery view can open right
   there, no reload required to see what is held.
4. Reload, crash, or a tab that goes away some other way → next load checks the log for this
   tenant. Anything still present was never confirmed — the recovery view opens with that list.
5. Each item is reviewed in plain language and either reapplied (fresh edit, checked against
   current reality, cleared from the log on success) or discarded (removed, no dispatch). A
   reapply that hits a genuine new conflict shows the real refusal reason rather than retrying
   blindly or failing silently.

## Error handling

- **Storage unavailable or full** (private browsing, quota exceeded): falls back to today's
  behaviour exactly — the toast still fires, there is just no persisted safety net across a
  reload. Never a crash; matches how `saveWorkspaceLocally` already treats the same failure.
- **A reapply hits a genuine new conflict**: shown as the server's actual refusal reason, not
  swallowed or silently retried. The person decides — look at current state and redo it, or
  discard.
- **Old entries nobody has dealt with**: shown regardless of age rather than expired on a
  guessed cutoff. A stuck change either got resolved or it did not; silently dropping one after
  N days would be exactly the silent loss this exists to stop.

## Testing

- **Checked before writing this section, not assumed**: `scripts/scenario-validation.ts` runs
  in Node, which has no `window` — `lib/autosave.ts`'s existing local-mirror functions
  (`saveWorkspaceLocally`/`loadWorkspaceLocally`), the closest precedent for this exact category
  of code, have no scenario coverage today and are verified live only. `lib/pendingActions.ts`
  will follow the same convention (hardcoded to `window.localStorage`, matching
  `lib/autosave.ts`'s style rather than introducing a new dependency-injection pattern this
  codebase doesn't otherwise use) — so it inherits the same limit honestly, rather than this
  design claiming scenario coverage that would not actually exercise anything.
- What scenario coverage *can* reach: the reapply mechanism's core logic — stripping a stale
  `expected` so `dispatch`'s own `withExpectation` (`components/IssueWorkspace.tsx:374-386`)
  recomputes it fresh against current state — is plain object logic once separated from
  `localStorage`, and gets a scenario.
- Everything storage-shaped (save, load, clear, and the boot-time "found leftovers" check) is
  live verification against production, the same discipline used for every other change this
  session: actually trigger a halt, reload, confirm the recovery view shows the right items with
  the right plain-language description, confirm reapply genuinely re-saves and clears the entry,
  confirm discard removes it without dispatching anything.

## Resolved during implementation

`useAutosave.ts:465-475`'s `beforeunload` handler (warns the browser's native "leave this site?"
dialog when the queue is non-empty or halted) was live-verified directly rather than left as an
open question: it fires correctly the moment a genuine halt leaves the in-memory queue non-empty,
confirmed against production by triggering a real 409 and reloading. It does not change this
design — it is a warning at the moment of leaving, not a recovery mechanism, and this feature is
what covers the case where someone leaves anyway (or the tab goes away without a chance to warn:
crash, background discard). Whether that is what happened to Nishant and Tarun's original
tabs is still unconfirmed and not answerable from the code — worth asking them directly if it
comes up again, but it no longer blocks or informs this design.

**Known limitation, not fixed in this pass**: `beforeunload` reads `state.status` from
`useAutosave`'s own state, not from the pending-actions log. Discarding every entry in the
recovery panel clears the log and (once it is empty) the halted marker, but does not reset the
*live* session's `saveStatus.status`, which stays `'error'` until the page reloads — because the
underlying halt (`lib/queue.ts`'s `Halt: 'stopped'`) is itself only ever cleared by a reload, by
policy, not by anything this feature does. A person who opens the panel and discards everything
in it still sees the top-of-screen indicator reporting a broken save afterward, in the same
session, with the reassuring panel now gone. Not data loss, and consistent with the existing
halt policy — but it is the shape of failure this plan's own "what would send this back to the
design" section warned about (the panel itself becoming ignored like the corner badge was), so
it is recorded here rather than left to be rediscovered as a surprise. A future pass could have
Discard (once the log empties) also force the live queue's halt back to a clean, non-error
resting state; out of scope for this one.
