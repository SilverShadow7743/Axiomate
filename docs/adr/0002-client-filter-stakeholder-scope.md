---
artifact: ART-20260905-006
status: approved
date: 2026-09-05
---

# 0002. Client filter stakeholder scope is a derived view default over the existing read gate

## Context

`ART-20260905-004` asks the Client filter in the issue workspace to rest at nothing chosen, to
read "All" as the signed-in person's stakeholder projects, and to remember each person's choice
(`docs/pending-actions.md` D1, requested 2026-08-17). The design is open on two axes.

**Axis A: what "stakeholder" resolves to.** The requester recorded this as the open question and
it is not answered here. The candidates in the data, read on 2026-09-05:

| Candidate | What the schema holds | Person join | Tier | Cost of using it for the filter |
| --- | --- | --- | --- | --- |
| Live `Allocation` | `projectId`, `startDate`/`endDate`, `percentage`, `deletedAt` (`prisma/schema.prisma:622`) | `personId` optional, name fallback | project | A capacity fact read as an attention fact, against the sibling separation in `CLAUDE.md`; "live" needs a date rule the code does not define for this purpose |
| Named on the `Engagement` | `engagementLeader`, `projectManager`, `clientSponsor` are `String @default("")` (`schema.prisma:543-546`) | none, free-text names | engagement | A name-only join, or a migration to ids; then a walk down to every project under the engagement |
| Role scoped to the project | No such permission concept; `OrgRole` grants are global, `ScopeOverride` carries no roles or people | n/a | n/a | Collapses into `ProjectMember.projectRoleId`, which is documented as descriptive only |
| `ProjectMember` | `projectId`, `personId` required, `projectRoleId`, `removedAt` (`schema.prisma:652`; `lib/staffing.ts`) | required | project | None new: it is what the read gate already enforces (`redactForReader`, `projectView`, `memberProjectIdsFor`) |
| Named on the SOW (A4) | `Sow` has no person reference | none | n/a | Not computable today |

The requester's counter-example, "a client sponsor has no allocation", does not separate these:
a client-role sponsor's view is governed by `Person.clientScopeId` and `clientView`, and the
membership design states nobody is both a client seat and an internal member. An internal sponsor
is a `ProjectMember` with `PROJROLE_SPONSOR`.

**Axis B: where a person's choice persists.** Browser `localStorage` (`lib/viewChoice.ts`), a
per-person map on the operating model (`model.notificationPrefs`, `setNotificationPref` in
`lib/workspace.ts`), or personal saved views (a stated non-goal of
`docs/plans/2026-08-31-saved-views-design.md`).

Two boundaries already exist and are not disturbed: `clientView` for client-role seats, and the
project read gate with its `ROLE_ADMIN` and machine-actor exemption (`isExempt`,
`lib/access.ts:407`) for internal seats. Since that gate shipped on 2026-08-24, a week after D1
was recorded, part (2) of the request is already true for every non-exempt internal seat under
the `ProjectMember` reading.

## Decision

1. **Stakeholder-scoping is a view default, not an authorisation change.** `redactForReader`,
   `projectView`, `isExempt`, `clientView` and `can()` are unchanged by this feature.
2. **One pure function.** A person's stakeholder projects come from exactly one function of
   `(WorkspaceState, resolved personId, today)` where `today` is a parameter only if the
   definition is date-bounded. It is parameterised by the definition the product owner fixes in
   OQ1 of the specification. If that is `ProjectMember`, the function is `memberProjectIdsFor`
   in `lib/projectBoundary.ts` and nothing is added beside it. If it is `Allocation`, the
   function lives next to `memberProjectIdsFor` with its divergence from the read gate stated in
   its comment. If it is Engagement names, this ADR is superseded, because the fields must become
   person ids first.
3. **A typed sentinel for "nothing chosen".** `FilterState.client` in `lib/types.ts` carries a
   named resting value distinct from the string `'None'` the Discipline facet already uses as a
   real filter. Every consumer that compares to the literal `'All'` compares to the resting
   value instead.
4. **The person's choice is a stated preference on the operating model.** A per-person map keyed
   by directory `personId`, in the `notificationPrefs` shape: one reducer arm with the
   self-service gate, one `ACTION_PERMISSIONS` row, `SHAPES` and `KINDS` entries, audited,
   tenant-keyed through the existing `OperatingModel` JSON column; no Prisma migration. The value
   is a node id, never a client name; an id that does not resolve in the reader's tenant degrades
   to nothing chosen. The stakeholder set itself is never stored.

## Alternatives rejected

- **Narrow the read gate for exempt seats, or add a second gate in `redactForReader`.** The
  request is about what a person sees by default, not what they may see. The gate and its
  exemption were decided for access reasons on 2026-08-24; coupling an attention default to them
  re-joins two questions that design separated. Stakeholder visibility as a permission is a
  different requirement.
- **Store the computed stakeholder set.** Derived values are never stored; the set changes with
  every membership, allocation or engagement edit and a copy drifts from the gate.
- **Reuse the string `'None'`.** Same token, opposite meaning, in adjacent controls of one bar;
  wrong in `matchesFilters`, `parseSavedFilters` or the Filters chip, whichever is fixed last.
- **Browser `localStorage`.** Follows the machine, not the person; no attribution or audit;
  lost on a new device. It touches no protected path, which is its one advantage. If the product
  owner reads "for them" as per browser at OQ5, this alternative stands and the architect may
  prefer it.
- **A personal saved view.** Saved views are deliberately the team's, carry the view choice with
  the filters, and are visible to everyone. Reopening the personal-versus-shared split is its own
  decision.
- **A union of definitions.** Not rejected on merit and not decided here. Three joins, one of
  them name-only, and the divergences the product owner needs to see disappear inside the union.
  If OQ1 chooses a union, a new ADR carries each member's cost.

## Consequences

- Under `ProjectMember`, non-exempt internal seats already have part (2); the work is the
  sentinel, the preference, the reset paths (`Clear`, `revealIssue`) and the report label.
  Exempt seats and records with no project-tier ancestor are where the filter's All can differ
  from the payload; that is a display choice the product owner makes in OQ11.
- `lib/types.ts` changes; with a per-person preference so do `lib/workspace.ts` and
  `lib/access.ts`. The plan needs the architect at Gate 3.
- Every consumer of the literal `'All'` is touched (FilterDropdown, FiltersHeader,
  `matchesFilters`, `visibleRows`, `scopeLabel`, `openClientPack`, `revealIssue`);
  `parseSavedFilters` must exclude the sentinel on save or define it on apply, and a saved view
  holding `'All'` changes meaning to the person-relative All.
- The preference map sits inside `model`, which `clientView` spreads to client seats; it must be
  withheld from client views the way `projectMembers` is.
- If the `ProjectMember` backfill was never committed against production (OQ12), the
  `ProjectMember` reading makes an already-empty tree look like a feature outcome. Checked before
  Gate 1 closes.

## Principles checked

- **Tenant isolation at both layers.** Every collection any candidate reads (`projectMembers`,
  `allocations`, `engagements`, `model`) already loads under `withTenant()`; the preference
  persists through the existing `OperatingModel` path. No new `lib/db/*.ts` function and no new
  table, so no new row-level-security policy.
- **Pure reducer.** The stakeholder function is pure in `(state, personId, today)`; it never reads
  the clock. The preference arm is pure in the `setNotificationPref` shape.
- **Attribution as a parameter.** The signed-in person is `directoryPersonFor(model, actor)`
  resolved server-side from the sealed session and passed in; a preference write carries `actor`
  and is self-service gated. No `personId` is taken from a request body.
- **Derived never stored.** The stakeholder set is computed at read. The picked node is a stated
  preference, something the person said, so storing it as an id does not breach the rule.
