# Milestone-level effort attribution — implementation plan

Follows `2026-09-20-milestone-issue-attribution-design.md`. **Ordering principle:** the
attribution write first, proven refused and accepted through the reducer, before the rollup
function that reads it — a wrong attribution is cheaper to catch here than in a variance figure
that merely looks plausible. Storage after both. **The two UI surfaces (CommercialPanel's
Variance column, DetailPanel's milestone select) are this plan's last step and, deliberately,
not part of the same pass that builds steps 1–5** — new UI earns its own look before it ships,
the same discipline `component-standards.md`'s Forms section already states, and this plan does
not shortcut it by building blind.

## 1. `lib/workspace.ts` — `setIssueMilestone`, modelled on `attributeToSow`

    case 'setIssueMilestone': {
      const issue = state.issues[a.issueId]
      if (!issue) return { state, error: 'That record no longer exists.' }
      if (a.milestoneId) {
        const milestone = state.milestones[a.milestoneId]
        if (!milestone) return { state, error: 'That milestone no longer exists.' }
        // The issue's own SOW attribution (via its project's sowId) has to match the
        // milestone's SOW, or a variance figure would count effort against a contract that
        // never named it. `projectOf` already exists (lib/workspace.ts) and returns the
        // nearest project-kind ancestor's node id; its own `sowId` is the SOW, if any.
        const projectId = projectOf(state, a.issueId)
        const projectSowId = projectId ? state.nodes[projectId]?.sowId ?? null : null
        if (milestone.sowId !== projectSowId) {
          return { state, error: 'That milestone belongs to a different statement of work than this issue is attributed to.' }
        }
      }
      // audit + state.issues update, same shape as attributeToSow
    }

Gate: `sow.attribute` (the same permission `attributeToSow` already uses — this is the same
kind of commercial attribution, one level finer, per the design doc). Add to `lib/access.ts`'s
`PERMISSION_BY_KIND` map alongside `attributeToSow`, and to `SHAPES` in `lib/actionShape.ts`
(`{ issueId: req(id), milestoneId: opt(idOrNull), now }`) and `KINDS` in
`app/api/workspace/route.ts`.

**The check most likely to be got wrong:** finding "the issue's own SOW." An issue does not
carry `sowId` directly — its **project** does (`HierarchyNode.sowId`). `projectOf` (already
exported from `lib/workspace.ts`, and already what `attributeToSow`'s own validation is built
on top of via `scopeChainOf`) finds the project; `state.nodes[projectId].sowId` is the SOW. No
new helper needed — reuse `projectOf` directly, here and in the UI step.

**Verified by:** `npx tsc --noEmit`, then step 2.

## 2. Scenario `K2` — the attribution, through the reducer

New scenario, not a rewrite of `K` (which stays exactly as it is — proven, per-issue, and about
a different thing: recording effort correctly, not about which milestone it counts toward).

1. A SOW with two milestones. An issue attributed to the SOW's project, then to milestone A.
   Assert the attribution lands and is audited.
2. Attempt to attribute the same issue to a milestone on a **different** SOW. Assert refused,
   with the message naming why.
3. Clear the attribution (`milestoneId: null`). Assert it clears.
4. Attempt to attribute an issue whose project has **no** SOW at all. Assert refused — there is
   no SOW for the milestone to belong to in common with.

**Verified by:** `npm run validate:scenarios` — `K2` reads PASS, `K` unchanged.

## 3. `lib/commercial/sow.ts` — `milestonePosition`

    export function milestonePosition(
      milestone: Milestone,
      issueIds: string[],
      estimates: Record<string, IssueEstimate>,
      timeEntries: Record<string, TimeEntry>,
      bands: SizeBand[],
    ): MilestonePosition

A narrower read of exactly what `sowPosition` already sums (`plannedHours`, `actualHours`,
`varianceHours`, `varianceIssueCount`, `unestimatedCount`), filtered to
`issue.milestoneId === milestone.id`. The caller supplies `issueIds` pre-filtered — this
function does not query `state.issues` itself, matching `sowPosition`'s own no-I-O discipline.

**Verified by:** a `K3` scenario — two issues under one SOW's two milestones, one estimated and
spent past its baseline, one untouched; assert `milestonePosition` for each milestone counts
only its own issue, and that summing both milestones' `plannedHours` equals the SOW-level
`sowPosition.plannedHours` for the same issue set — the rollup must not silently disagree with
the coarser figure it is a slice of.

## 4. `prisma/schema.prisma` — the column

    /// Which milestone this issue's effort counts toward, when the SOW it is attributed to has
    /// more than one. No FK -- same convention as InvoiceLineItem.milestoneId: a milestone later
    /// renegotiated or withdrawn must not orphan or cascade-delete work with real hours logged
    /// against it. Null means "not attributed to a specific milestone" -- the default for every
    /// issue today and for any SOW with only one milestone, where the distinction carries no
    /// information. See docs/plans/2026-09-20-milestone-issue-attribution-design.md.
    milestoneId String?

Added to `model Issue`, near `applicationId` (the closest existing precedent: additive,
optional, references another top-level entity without an enforced relation). Additive, no
backfill.

**Verified by:** `npx prisma validate` from this environment (schema-only, no database needed —
see the note in the prior commit about why a real `migrate dev`/`diff` could not run here).
Nishant applies the migration and confirms `npm run audit:persistence` once on a network that
can reach the real database — same limitation as the timesheet stamp column, not a new one.

## 5. `lib/db/map.ts` — the mapper pair

`issueToRow`/`issueFromRow` already exist; add `milestoneId: i.milestoneId ?? null` /
`milestoneId: r.milestoneId ?? null` to each — a plain nullable string, no `Json` sentinel
question this time.

**Verified by:** `npx tsc --noEmit`.

## 6. UI — deliberately last, and its own pass

**`DetailPanel`'s Overview tab (issue only):** a milestone select in the Classification group,
beside `{TIER_MODULE}` — matching where `component-standards.md`'s `.field select` pattern
already lives. Options are the issue's own SOW's milestones (via `projectOf` + the project's `sowId`, step 1's
reuse); empty option "Not attributed to a milestone." Absent entirely when the issue has no
SOW attribution — a control with nothing to choose between must not be shown, the same rule
`FiltersHeader`'s own facets already follow. Dispatches `setIssueMilestone`.

**`CommercialPanel`'s Payment schedule table:** a `Variance` column, populated only for a
milestone with at least one attributed issue (`milestonePosition(...).varianceIssueCount > 0`)
— the same "show nothing rather than a zero that means unknown" rule `sowPosition`'s own
`unestimatedCount` already follows. Reads `rate.view` the same way the rest of the panel's
figures already do.

**This step needs its own review before it ships** — a screenshot in a real browser at desktop
width, checked against `axiomate-design-system.md`'s density rule and `ux-principles.md`
Principle 6 (planning/timesheet information scannable), not assumed correct from source alone.
The prior five steps do not depend on it: `milestonePosition` and the attribution are complete
and provable without a screen to show them on.

---

## The detail most likely to be got wrong

**A milestone belongs to exactly one SOW; an issue attributes to a SOW via its *project*, one
level up.** The validation in step 1 has to walk from issue → project → `sowId`, not read a
field that does not exist on `Issue` itself. Getting this backwards — checking the issue's own
(nonexistent) `sowId` — will type-check against a stale mental model and fail at the first real
attribution attempt, not silently.
