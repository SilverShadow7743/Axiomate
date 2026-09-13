# Commercial register — design

Second of the three new pages (`docs/strategy/2026-09-12-business-process-review.md` §4,
Design 2). Same shape as Resourcing: `CommercialPanel.tsx`'s per-engagement computations
(`sowPosition`, `sowCostOf`, `milestonePosition`, `invoicePosition`) already compute exactly
what a portfolio-wide view needs — this page is a new caller over every SOW at once, not new
computation, `rate.view`-gated exactly as the cost figures already are inside `CommercialPanel`.

## What already does the work, and the one new resolution step

`CommercialPanel` scopes `sows`/`projects` to one `row` (an engagement) before computing
positions. The register needs every SOW firm-wide instead. `lib/engagement.ts` already
exports a general-purpose `issuesUnder(state, nodeId)` — works for any node, not only an
engagement — so per SOW: find its projects (`state.nodes` where `kind === 'project' &&
sowId === sow.id`), union `issuesUnder(state, project.id)` across them, exactly the same
join `CommercialPanel`'s own `issuesUnder` memo does, just not pre-filtered to one
engagement's projects first.

```ts
for (const sow of Object.values(state.sows).filter((s) => !s.deletedAt)) {
  const sowProjects = Object.values(state.nodes).filter((n) => n.kind === 'project' && !n.deletedAt && n.sowId === sow.id)
  const issueIds = [...new Set(sowProjects.flatMap((p) => issuesUnder(state, p.id).map((i) => i.id)))]
  const position = sowPosition(sow, issueIds, state.estimates, state.timeEntries, state.model.sizeBands, Object.values(state.changes))
  const cost = mayViewRate ? sowCostOf(Object.values(state.rates), issueIds, state.timeEntries) : null
  // milestones/invoices, below
}
```

## Milestones and invoices — reusing the exact existing functions

- **Next milestone**: from `Object.values(state.milestones).filter(m => m.sowId === sow.id && !m.deletedAt)`,
  the earliest `plannedDate` among those where `acceptance !== 'Accepted'`. Not a new
  computation — `milestonePosition` exists for the fuller per-SOW rollup CommercialPanel
  shows; the register's "next milestone" column is a simpler derived read over the same raw
  list, since the register's job is finding a SOW, not replacing its detail screen.
- **Overdue milestones tab**: milestones where `plannedDate < today && acceptance !== 'Accepted'`
  — the plain, direct reading of the same two fields, no new "overdue" concept invented.
- **Unpaid invoices tab**: `Invoice.status === 'Sent'` (raised, not yet paid) — `Invoice`'s own
  status enum already distinguishes this from `Draft`/`Paid`/`Cancelled`; no new status invented.
- **At-risk margin tab**: `cost.marginPct` below a **configurable** threshold — reusing the
  engagement health score's own disclosure discipline (`lib/portfolio.ts`): a printed,
  visible threshold in the UI, not a silent cutoff. For v1, the threshold is a plain number
  input on the tab itself (defaulting to 20%), not a new Configuration section — a
  Configuration-level setting is a real escalation if this needs to be a firm policy rather
  than a filter someone types in when they want it.

## View wiring

Same pattern as Resourcing: `WORKSPACE_VIEWS` gains `'commercial'`; `AppSidebar`'s **Records**
group (alongside Timesheets/Mail/People — commercial data is a record of the engagement, the
same category timesheets and mail already sit in, not a workspace view like Tree/Board) gains
it; `IssueWorkspace.tsx` gets the same stale-view guard shape, gated on `rate.view` (the same
permission `CommercialPanel`'s own cost figures already require) rather than `capacity.allocate`.
Never `CLIENT_GROUPS`.

## Page structure

Sub-tabs exactly as the wireframe: **All SOWs** (reference, engagement, value, margin, status,
next milestone, owner) · **Overdue milestones** · **Unpaid invoices** · **At-risk margin**.
Row click opens... nothing new — `CommercialPanel` itself is reached by opening the
engagement's own detail drawer, which this register does not shortcut around (a genuinely new
deep-link from register row to that specific SOW's tab is a real, separate piece of
navigation plumbing, not a one-line addition — named explicitly rather than half-built).
For v1, a row names the engagement so the user can find and open it themselves the existing
way; a direct link is a fast-follow, same discipline Resourcing applied to "allocate directly
from this page."

**Owner** column: the engagement node's own `.owner` field (`state.nodes[sow.engagementId]?.owner`)
— already-modeled, no new field.

## Out of scope (v1)

- Direct row-to-CommercialPanel deep link (named above).
- A Configuration-level margin-threshold policy (the tab's own input is v1's answer).
- Any SOW status change or commercial write action from this page — strictly a finder,
  matching the review's own framing of it as "a finder, not a replacement for the detail screen."

## Risk

Low, same class as Resourcing: additive, read-only, no reducer arm touched. The one thing
worth being careful about: `rate.view` must gate the WHOLE page's rendering (including the
non-margin columns that don't individually need it), not just the margin figures — a register
that shows SOW value/status to someone without `rate.view` while hiding only the margin column
would be a narrower but real version of the exact "hidden on screen, not withheld" failure
`docs/design/rates` documentation already names as a solved problem elsewhere; this page must
not reopen it.

## Testing

A new scenario proves the multi-project-per-SOW join: two projects under different parts of
the tree, both attributed to the same SOW, confirms `issueIds` unions both projects' issues
(not just one) — the same "did we actually go firm-wide" proof `RSC1` gave Resourcing, this
time for the SOW-to-projects direction rather than the person-to-allocations one. The
milestone/invoice filters are direct field reads, not proven separately — `Milestone`/`Invoice`'s
own status enums are already scenario-proven elsewhere; this page only reads them.
