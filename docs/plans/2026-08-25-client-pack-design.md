# Weekly and monthly client packs — design

## What this answers

RP2 in the scenario suite: *"A client-safe weekly pack and a monthly governance pack can be
produced."* `NOT IMPLEMENTED`, with a stale blocker — its recorded reason, *"no field marks a
record or a note as client-safe,"* predates `lib/clientBoundary.ts`, built under
`docs/plans/2026-08-22-client-boundary-design.md`, which explicitly deferred *"no weekly pack"*
to a later phase. This is that phase. Confirmed against real data before designing anything: of
255 live issues, only 4 are marked `clientVisible` (all under OAPIL; SLG has none) — the pack
this design produces will be genuinely thin until a firm goes through and marks its backlog, and
the pack says so rather than hiding it.

## What this is

**Both packs are client-facing**, confirmed directly rather than assumed — "governance" here
means the client's own steering committee, not internal leadership. Both are therefore built the
same way: on top of `clientView(state, clientScopeId)`, never re-deriving what counts as
client-safe. Neither pack is scheduled or stored — both are on-demand, computed live when opened,
matching `lib/reports/dailyIms.ts`'s own established stance and its own stated reason: a report
whose contents can disagree with what is actually in the tree is the kind of thing people stop
trusting.

**1. `lib/reports/clientPack.ts`** (new), two pure functions:

- `buildWeeklyClientPack(state, clientScopeId, asOf)` — a position summary (open/closed counts,
  completed items counted even where a screen would hide them by default, the same call
  `dailyIms` already makes) plus issue rows — subject, status, severity, due, last activity —
  drawn from `clientView()`'s filtered subset and windowed to the 7 days before `asOf`. No note
  bodies: `dailyIms` itself is issue-row-only, and a note written for internal working notes is
  not necessarily written for a document handed externally — this pack does not open that
  question by including them.
- `buildMonthlyGovernancePack(state, clientScopeId, asOf)` — a rollup, not a list: counts by
  status and by severity across the client-visible subset as it stands now, and raised-vs-resolved
  movement in the 30 days before `asOf`, read from the audit trail the same way `dailyIms` already
  reads its own "sections needing attention." **No milestone section** — see "What this
  deliberately is not."

Both functions also report, in their own return shape, how many of the client's total records
are actually visible — `{ shown: number, total: number }` — per the earlier decision to state
this rather than let a client read "3 open issues" and have no way to know whether that means the
engagement is quiet or that almost nothing has been marked visible yet.

**2. The client scope.** Neither function accepts an ambient filter; the caller resolves one
specific client's scope node id before calling either — the same single-client precondition
`clientView()` itself already has. In the screen, this is the client the consultant already has
selected via the existing tree/board client filter (`filters.client`, matched by name against
`state.nodes` to find the `kind === 'client'` node's id) — refused with a clear message if "All
clients" is selected, since there is no such thing as a pack for more than one client at once.

**3. Two new print-ready screens**, one per pack, reachable the way `dailyIms`'s export is
reachable today. A print stylesheet, nothing else new: no PDF library, no headless browser, no
new entry in `package.json`. "Download" is the browser's own print-to-PDF, the same choice this
codebase has already made elsewhere when a heavier dependency bought comparatively little (the
mail connector's own rejection of the Content Conversion connector, on record in
`infra/intake.bicep`, for exactly this shape of reason).

## What this deliberately is not

**Not a trend line.** With nothing scheduled and no stored history — and the audit trail itself
already documented as capped and browser-local without a database — there is no month-over-month
series to plot. The governance pack reports a point-in-time position and 30 days of movement, and
says so, rather than implying a history that was never captured.

**Not a milestone or commercial report.** `Milestone` records belong to a `sowId`, and
`clientView()`'s own rule is unconditional: *"Everything commercial and everything about people
is withheld wholesale regardless of flags."* `sows: {}` always. A governance pack that showed
delivery or acceptance state would be carving a narrow exception into an already-shipped,
already-tested security boundary — real scope creep this design explicitly declines to take on.
If a firm wants that later, it is its own design, not a line item here.

**Not scheduled.** Confirmed directly: both packs are opened on demand, computed live, nothing
prepared ahead of time and nothing to monitor for a missed run.

**Not a server-generated file.** A print-ready screen, not a PDF-construction library and not a
headless-browser render — confirmed after correcting an earlier claim that `dailyIms` already set
this precedent (it does not; `dailyIms` is a plain-text/CSV blob download, not a screen at all).

## Verification

Pure, scenario-driven, the same way `dailyIms`'s own report shape would be — hand-built
`WorkspaceState` fixtures, no database: a client with a mix of visible and internal issues
produces the right `{shown, total}` counts and only the visible rows; the weekly window excludes
an issue whose only activity was 8+ days ago; the monthly rollup's raised/resolved counts come
from the audit trail, not from re-deriving movement a different way; a client with zero visible
issues still produces a report (not an error), stating `0 of N` plainly rather than reading as a
failure.

Real data, before this is trusted for actual use: run the weekly pack against OAPIL, the one
client with any `clientVisible` issues today, and confirm the 4 known-visible issues are exactly
what appears, with `4 of 102` reported alongside them.

## What would send this back

- If a firm reading this design says the withheld count itself is too revealing — that "98
  records exist you cannot see" tells a client more about internal volume than the boundary
  should leak — that is a reason to revisit the disclosure decision, not to add a workaround.
- If `clientView()`'s filtering turns out to already be too slow to run on demand against a full
  workspace once a firm's real data is large enough — unlikely at today's scale, but the plan
  should check rather than assume, since neither pack has a caching layer to fall back on.
- If, once built, a firm immediately asks for the milestone exception this design just declined —
  that is real signal the boundary itself needs a second look, and belongs in its own design
  amendment to `docs/plans/2026-08-22-client-boundary-design.md`, not a quiet carve-out here.
