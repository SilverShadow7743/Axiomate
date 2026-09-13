# Configuration rail — sub-grouping within Operating model — design

Closes the second half of the UX audit's long-term item 3 ("IA review of DetailPanel's
tabs and Configuration's settings screens" — `docs/audits/` UX audit, and
`docs/plans/2026-09-13-detail-drawer-width-design.md`'s own status check that found
DetailPanel's half already resolved by the FastTabs migration). Configuration's half was
untouched: 30 settings screens across three rail groups (`ConfigWorkspace.tsx`'s `TABS`
array, ~118-149), and `Operating model` alone holds 19 of the 30 (excluding `index`,
"All settings," which is an overview link rather than a settings screen) — a flat list
wearing one category label.

## Approach chosen, and the one rejected

**Chosen: sub-headers within `Operating model` only.** The three existing top-level groups
(`Operating model`, `Automation`, `Governance`) are untouched — nothing moves across them.
`Operating model`'s 19 items render under five named sub-clusters in the rail instead of one
undifferentiated list. Lowest risk: the change is additive presentation inside one group's
render branch, `Automation` and `Governance` (11 items between them) are already short enough
not to need it, and nobody's muscle memory for "Governance has Rates" breaks.

**Rejected: reshuffle items across the three top-level groups** (e.g., moving the
process-control items into `Governance`, which already holds Goals/Health score/Rates).
More accurate in the abstract, but a bigger, more disruptive change for the same outcome —
it would touch `Governance`'s own list and order to solve a problem that is really about
`Operating model` alone, and moves settings people already know how to find. Named and set
aside rather than silently discarded.

## The five sub-groups

Ordered by the same reasoning the existing "All settings" index cards already imply (they
are not alphabetical — someone already grouped naming/classification items together, then
numbers/scoring, then process rules, before this design ever looked at them):

1. **Vocabulary & classification** — Terminology, Work types, Disciplines, Skills, Custom
   fields, Responsibilities. What things in this system are called, and what kinds of them
   exist.
2. **Roles & people** — Roles & people, alone. Kept as its own single-item cluster rather
   than folded into (1): it is the directory of actual people, not a naming/vocabulary
   choice, and is plausibly the single most-visited screen in Configuration. A one-item
   group is not a problem to be padded away.
3. **Rules & permissions** — Capabilities, Status transitions, Permissions, Approvals,
   Automation rules (renamed, see below), Scheduled pass. **`Capabilities` moved here after
   reading its own component, not left where the approved preview first placed it**: it is
   not about a person's skills or the firm's practice areas (that's `Skills`, already in
   group 1) — it computes and reconciles unreachable permission grants, the same logic
   `scripts/reconcile-grants.ts` runs from the command line. That is an access-control tool,
   the same class as Permissions and Approvals beside it, not a people-facing capability
   list.
4. **Estimation & capacity** — T-shirt sizing, Time recording, Allocation, Service levels.
   The numbers that drive planning, effort and SLA math.
5. **Templates** — Activity templates, Issue templates. Reusable shapes for future work.

`index` ("All settings") renders before any sub-group, exactly as it does today — it is an
overview link, not a settings screen, and does not belong inside a themed cluster.

## The naming collision, fixed in the same pass

The settings item labelled `'Automation'` (on/off automation rules, inside `Operating
model`) and the top-level rail group labelled `'Automation'` (Agent registry, Recurring
work, Workflows & templates, Routing & intake) are the same word for two different things,
one click apart. The item's label becomes **"Automation rules"** — a one-line change to
`TABS`'s `label` field, no id/data/logic touched, independent of which grouping approach
was chosen.

## Implementation shape

`TABS`'s entries gain an optional `subgroup?: string` field, set only for `Operating
model`'s 19 items (grouped per the list above) and absent everywhere else (`Automation`,
`Governance`, and `index`) — those keep rendering exactly as today. The rail's render
(~292-316) changes from one `.map` per top-level group to: render items with no `subgroup`
first (today, only `index`), then group the remainder by `subgroup` in first-seen order and
render each under its own `.cfg-rail-subgroup` header, visually one step lighter than
`.cfg-rail-group` (smaller, less weight — a second-level heading, not a second top-level
one).

## What this deliberately does not touch

- **The "All settings" card grid** (`SettingsIndex`, its own `cards` array) — a separate,
  hand-curated 18-item list that already omits some of `Operating model`'s items
  (`capabilities`, `disciplines`, `customFields`, `timePolicy`, `allocationPolicy`,
  `activityTemplates`, `issueTemplates`, `duplicates`, `rates`, `goals` do not appear in it
  today) and is not in this design's scope. Whether that card grid should also carry section
  headers, and whether its missing items are an oversight or deliberate, is a separate
  question this design does not answer — named so it is not silently assumed settled.
- **`Automation`'s and `Governance`'s own item lists** — untouched, per the chosen approach.
- **Any reshuffling of which top-level group an item belongs to** — the rejected approach,
  above.

## Risk

Low. Pure rendering change to one nav list plus one label string; no reducer arm, no config
op, no schema. The one thing worth being careful about: the `rates` item's existing
visibility filter (`.filter((t) => t.id !== 'rates' || can(...).allowed)`, ~303) must keep
applying correctly once `rates` items render inside `Governance`'s (unchanged) flat list —
it is untouched by this design, but worth naming as the one existing behavior a careless
refactor of the render loop could break by accident.

## Testing

No scenario — this is rail-rendering presentation with no data shape to prove, the same
reasoning the detail-drawer width design used. Verified by hand: `Operating model` in the
rail shows five sub-headers with the right items under each, `index`/`Automation`/
`Governance` render exactly as before, the renamed "Automation rules" label appears with no
functional change to what it controls, and a reader without `rate.view` still sees no Rates
item anywhere in the rail.
