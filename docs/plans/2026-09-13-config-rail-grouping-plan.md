# Configuration rail sub-grouping — implementation plan

Follows `docs/plans/2026-09-13-config-rail-grouping-design.md`. Same shape as the detail
drawer width plan: no data shape or reducer path to prove, so this is one step — rail data,
render loop and CSS changed together — verified by reading the diff and confirming it in a
browser, not by a scenario.

## 1. The sub-grouping, in one commit

- **`components/ConfigWorkspace.tsx`, `TABS` array (~118-149)**: add `subgroup?: string` to
  each of `Operating model`'s 19 entries per the design's five clusters (`capabilities`,
  `transitions`, `permissions`, `approvals`, `automation`, `watch` → `'Rules & permissions'`;
  `terminology`, `workTypes`, `disciplines`, `skills`, `customFields`, `responsibilities` →
  `'Vocabulary & classification'`; `roles` → `'Roles & people'`; `sizing`, `timePolicy`,
  `allocationPolicy`, `serviceLevels` → `'Estimation & capacity'`; `activityTemplates`,
  `issueTemplates` → `'Templates'`). `index` and every `Automation`/`Governance` entry get no
  `subgroup` field at all (not `undefined` explicitly set — simply absent, so the render
  logic's `t.subgroup` check reads `undefined` the same way for both). The `automation`
  entry's `label` becomes `'Automation rules'` in the same edit.
- **The `Tab` type** (wherever `TABS`'s element type is declared, alongside the array):
  confirm it already allows arbitrary extra fields or add `subgroup?: string` explicitly if
  it's a named interface rather than an inferred literal type — `npx tsc --noEmit` will say
  which.
- **The rail render (~292-316)**: replace the single `.map` per top-level group with, per
  group: render every entry with no `subgroup` first exactly as today (covers `index`, and
  all of `Automation`/`Governance` unchanged), then group the remainder by `subgroup` in
  first-seen order (a `Map<string, Tab[]>` built by one pass over the filtered, sorted-by-
  `subgroup`-appearance list — first-seen order needs the five subgroup names to already
  appear in that order in `TABS`, which the array edit above guarantees) and render each
  under a `<div className="cfg-rail-subgroup">{name}</div>` header before its items. The
  existing `rates`-visibility filter (`.filter((t) => t.id !== 'rates' || can(...).allowed)`)
  stays exactly where it is in the pipeline — applied before grouping, not after, so a
  `Governance`-group entry it would have hidden is still hidden regardless of the new
  subgroup logic (which `Governance` doesn't use anyway, but the filter's position must not
  move just because the loop around it changed shape).
- **`app/globals.css`**: add `.cfg-rail-subgroup` — same shape as `.cfg-rail-group` but one
  step lighter (smaller/less letter-spacing, or a lighter color — a second-level heading
  under a first-level one, not a second first-level one; exact values are a small visual
  call made at implementation time, not a data question). Add it to the existing
  `@media (max-width: 900px)` block's `.cfg-rail-group { display: none; }` rule (~4855) —
  the same "group headings organise a vertical list; in a scrolling strip they are just
  unreachable width" reasoning already documented there applies identically to a second
  level of the same list.

**Verified by:** `npx tsc --noEmit` (catches a `Tab` type mismatch if `subgroup` needs an
explicit interface field) and `npx eslint components/ConfigWorkspace.tsx`, both clean;
`npm run validate:scenarios` re-run, byte-identical `data/validation.json` (no reducer or
lib logic touched).

**The detail most likely to be got wrong:** grouping by first-seen order, not by iterating
an explicit ordered list of subgroup names — if the `TABS` array entries for one subgroup
end up non-contiguous (a future edit inserts an `Operating model` item between two
`'Rules & permissions'` entries without also giving it a subgroup or the right one), the
render would either split that subgroup into two headers with the same name or misplace an
item, and nothing would catch it except the manual browser check below. Worth a comment at
the `TABS` array itself saying subgroup entries must stay contiguous per name, so a future
edit is warned before it happens rather than caught after.

**Manual verification (no scenario possible for pure rail presentation):** open
Configuration, confirm `Operating model` shows five sub-headers in the design's order with
exactly the 19 items split as specified, `index` ("All settings") appears above all five
with no header of its own, `Automation` and `Governance` render exactly as before (no
sub-headers, same items, same order), the renamed "Automation rules" label appears and still
opens the same automation-rules screen with no behavior change, and — signed in as an actor
without `rate.view` — `Rates` still does not appear anywhere in `Governance`'s list. Also
check the mobile-width rail (≤900px, horizontal scrolling strip): confirm the new
`.cfg-rail-subgroup` headers are hidden there exactly like `.cfg-rail-group` already is, and
every item is still reachable in the flat scrolling order.

## Commit

One commit — the `TABS` data change, the render-loop change and the CSS are one indivisible
unit, same reasoning as the detail drawer width plan.

## What would send the design back

- If a future settings screen is added to `Operating model` and the person adding it has no
  reasonable subgroup to put it in — would mean the five clusters don't actually cover the
  space this config surface grows into, not that this plan was wrong for the 19 it covers
  today.
- If the "All settings" card grid (named explicitly out of scope in the design) turns out to
  need the same sub-headers for consistency once this ships and the mismatch reads as
  unfinished rather than deliberate — a real, separate follow-up, not a sign this plan itself
  needs revisiting.
