# Weekly and monthly client packs — implementation plan

Follows `docs/plans/2026-08-25-client-pack-design.md`, approved by the user. Four steps: the two
pure report builders and the client-scope lookup they depend on come first, since both are
provable by scenario with no database and no screen; the two print-ready screens come next, since
they depend on both; real-data verification against OAPIL comes last, because it is the one step
this repository's own harness cannot perform.

## Step 1 — client-scope resolution, then the two pure report builders

**Touches:** `lib/reports/clientPack.ts` (new).

Checked before writing this plan, not assumed: `lib/tree.ts`'s existing `clientOf` (line 444) is
a **local, unexported closure inside `visibleRows`**, walking a `ScheduleRow` *up* to its nearest
client ancestor and returning that client's *name*. It cannot be imported, and it runs in the
wrong direction for what this step needs — starting from `filters.client` (a name, confirmed at
`lib/tree.ts:455` and `components/FilterBar.tsx:287`), the pack needs the client's own node *id*,
which is what `clientView(state, clientScopeId)` actually takes. So this is new, not adapted:

```ts
export function clientScopeIdFor(state: WorkspaceState, clientName: string): string | null {
  return Object.values(state.nodes).find((n) => n.kind === 'client' && n.name === clientName)?.id ?? null
}
```

Then `buildWeeklyClientPack(state, clientScopeId, asOf)` and
`buildMonthlyGovernancePack(state, clientScopeId, asOf)`, both calling `clientView` exactly once
each and deriving everything — the issue rows, the position counts, and the `{shown, total}`
disclosure — from that single call's result, never a second independently-run count. `total` is
`Object.values(state.issues).filter(i => !i.deletedAt && <same ancestry check clientView uses>)`
— the *pre-boundary* count for the same client, which necessarily means duplicating `clientView`'s
own ancestry walk for the total side, since `clientView` itself only returns what survives. Keep
that duplication small and named (a `underScopeOf(state, parentId, clientScopeId)` helper mirroring
`clientView`'s own inline `underScope`) rather than re-implementing ancestry-walking differently in
two places.

`buildWeeklyClientPack`'s issue rows follow `dailyIms`'s own shape (subject, status, severity,
due, last activity) windowed to the 7 days before `asOf`, with position counts including
completed items the same way `dailyIms`'s own position figure does (`lib/reports/dailyIms.ts`'s
own stated reason: *"a status report that says '0 done' would be worse than useless"*).
`buildMonthlyGovernancePack` returns counts by status and by severity across the client-visible
subset as of `asOf`, plus raised-vs-resolved movement in the 30 days before `asOf` — read from
`state.audit`, the exact mechanism `dailyIms` already uses for its own "sections needing
attention," not a new movement-detection path that could disagree with it for the same underlying
data. No `sowId`/`Milestone` reference anywhere in this file, per the design's own decision.

**Verified by:** `npx tsc --noEmit`; scenario coverage in `scripts/scenario-validation.ts` —
`clientScopeIdFor` resolves a known client name and returns `null` for an unknown one; a client
with a mix of visible and internal issues produces the right `{shown, total}` and only the
visible rows appear; an issue whose only activity is 8+ days old is excluded from the weekly
window; the monthly rollup's raised/resolved figures match a hand-built audit trail; a client
with zero visible issues still returns a report stating `0 of N`, not an error or an empty object.

## Step 2 — the two print-ready screens

**Touches:** two new screens (route or panel — see the open question below) plus a shared print
stylesheet, wired to `clientScopeIdFor` and the two builders from step 1.

**Checked before writing this plan:** no `@media print` rule exists anywhere in `app/` or
`components/` today, and no full-page or modal "preview" pattern exists to model this on either —
`dailyIms`'s own export (`components/IssueWorkspace.tsx`'s `exportDailyIms`, lines 1677–1687) is a
plain blob download via a local `download()` helper (line 1637), never a screen at all. This step
has no precedent in this codebase to follow, unlike the pure logic in step 1, which follows
`dailyIms`'s report shape closely. It is the **highest-uncertainty step in this plan** — not
because it risks breaking something that works today (nothing here modifies existing UI, so there
is no regression risk in the usual sense), but because "print-ready screen" is a real, unbuilt
pattern being invented for the first time, and the actual layout/print-CSS work cannot be scoped
precisely until it is underway. Budget this step as the one most likely to run long or need a
second pass at the stylesheet once printed output is actually checked in a browser's print
preview, not just read as HTML.

Entry point: alongside `dailyIms`'s existing export action in `IssueWorkspace.tsx`, resolve
`clientScopeIdFor(state, filters.client)` first — **if `filters.client === 'All'`, refuse before
building anything**, with a message telling the consultant to pick one client first (mirroring
`sendingMailboxFor`'s own refusal-with-guidance shape in `lib/outbound.ts`, not a silent no-op and
not an arbitrary pick).

**Verified by:** `npx tsc --noEmit`; `npm run build`; opening each screen in a browser locally
against seeded data and confirming — via the browser's own print preview, not just reading the
rendered HTML — that the stylesheet produces a legible, reasonably paginated document, and that
the `{shown, total}` line and the 7-/30-day window are both visibly present on the printed output,
not only in the on-screen version.

## Step 3 — real-data verification against OAPIL

**Touches:** nothing in the repository. Verification only.

Open the weekly pack for OAPIL specifically — the one client with any `clientVisible` issues
today — and confirm the report lists exactly the 4 known-visible issues (cross-checked against
the direct database query this session already ran while designing this: `OAPIL: total 102,
visible 4`), with `4 of 102` reported alongside them. Then open the monthly governance pack for
the same client and confirm its status/severity counts agree with the same 4 issues, and that its
30-day movement figure is checked by hand against `dailyIms`'s own movement count for the same
window (both read the same audit trail, so a disagreement between the two means one of them is
wrong, not that they are allowed to differ).

**Verified by:** the on-screen and printed output themselves, read directly against the real
values above — not a script, since this is the step confirming the pure logic proven in step 1
also agrees with what production actually holds.

---

## Regression risk

None in the usual sense. `lib/reports/clientPack.ts` is a new file; `clientView` is called, never
modified; nothing existing in `IssueWorkspace.tsx` or `lib/tree.ts` is changed, only added to.
Step 2 is named above as the highest-*uncertainty* step instead, for the reason stated there: no
existing print/preview pattern in this codebase to build on.

## What merges into one commit, what stands alone

**Steps 1's two parts — `clientScopeIdFor` and the two builders — merge into one commit.** Unlike
the Teams-intake plan's step 1/2 split (a config type with no caller, then a function with nothing
to call), here the dependency runs the other way and is total: `buildWeeklyClientPack` and
`buildMonthlyGovernancePack` take a `clientScopeId` as a required parameter and cannot be
meaningfully tested without something producing one, while `clientScopeIdFor` has no reason to
exist in this codebase except to feed them. Splitting them would be two commits where the first
is dead code and the second is untestable alone. **Step 2 stands alone** — the first commit
touching rendered UI, and the one most likely to need its own follow-up pass once real print
output is checked, which should not be entangled with the pure logic's own review. **Step 3
produces no commit** — verification only, the same shape as this session's own OAPIL dry-run
checks throughout.

## What would send this back

From the design document directly:

- If a firm reading this says the withheld count (`{shown, total}`) itself is too revealing —
  telling a client roughly how much internal volume exists — that sends the *design* back to
  reconsider the disclosure decision, not this plan to patch around it.
- If `clientView()` turns out too slow to run on demand once a firm's real data is large enough —
  surfaces at step 3, the first point this plan runs it against the full real workspace rather
  than a scenario fixture.
- If, once built, a firm immediately asks for the milestone exception the design declined — that
  is signal for a design amendment to `docs/plans/2026-08-22-client-boundary-design.md`, not
  something to add here quietly.

One addition from writing this plan, about sequencing rather than the design's substance:

- If step 2's print stylesheet turns out to need real layout iteration beyond what a single pass
  can reasonably absorb — if the first print-preview check in step 2 shows the report seriously
  mis-paginating or unreadable rather than merely rough — that is a finding that step 2 was
  under-scoped as "one step," not evidence the print-ready-screen approach itself was wrong; treat
  it as cause to split step 2 into its own two-pass sequence (a working screen, then a dedicated
  print-CSS pass) rather than pushing through in one sitting.
