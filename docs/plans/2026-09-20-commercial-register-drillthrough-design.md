# Commercial register drill-through — design

Fast-follow named in `docs/plans/2026-09-13-commercial-register-design.md` ("a genuinely new
deep-link from register row to that specific SOW's tab is a real, separate piece of navigation
plumbing, not a one-line addition — named explicitly rather than half-built"). Found live this
session (Coverage Audit, sixth pass): a row in the Commercial sidebar page does not open
anything, confirmed against `components/commercial/CommercialRegister.tsx`'s own source — its `<tr>`s carry
no `onClick`.

## The plumbing already exists, unnoticed at the time the v1 doc was written

`CommercialPanel` (the detail screen with the Milestones/Variance view) renders only for a row
whose `kind === 'engagement'` (`components/DetailPanel.tsx`, gated on `row.kind === 'engagement'`
before mounting `ScopePanel` + `CommercialPanel`). So "open this SOW's own tab" resolves to
"select its engagement's record" — the register already carries `r.engagement` on every row
(`state.nodes[sow.engagementId]`, computed in the `rows` memo).

Selecting a record from a docked panel is a solved problem elsewhere in this same file:
`MyWorkPanel` and `PortfolioPanel` both take an `onSelect={revealIssue}` prop
(`components/IssueWorkspace.tsx`, lines ~2626–2645). `revealIssue(id)` — already proven, not new
code — handles the unsaved-work guard, expands the record's ancestors, adjusts filters if the
record wouldn't otherwise be visible, and switches to Tree when the current view doesn't pair
with a detail drawer (Commercial is one such view, per `DETAIL_INCOMPATIBLE_VIEWS`). Wiring
`CommercialRegister` the same way costs one new prop and one callback per row — not the
"separate piece of navigation plumbing" the original doc anticipated, because that plumbing has
since been built for two other pages and never connected here.

## What changes

- `CommercialRegister` gains `onSelect?: (id: string) => void`, the same optional-callback shape
  `MyWorkPanel`/`PortfolioPanel` already use.
- Each of the four tables (All SOWs, Overdue milestones, Unpaid invoices, At-risk margin) gets
  its SOW reference cell wrapped in a `<button className="btn-link">`, matching the convention
  `PortfolioPanel.tsx`'s `Line` component already uses for the same purpose — a real button, not
  a clickable `<tr>`, so keyboard and screen-reader access come for free rather than being a
  follow-up.
- `onClick={() => r.engagement && onSelect?.(r.engagement.id)}` — guarded, since an engagement
  can in principle be missing (a deleted node), matching how the Owner column already falls back
  to a plain dash when `r.engagement` is absent.
- `IssueWorkspace.tsx`'s mount site gains `onSelect={revealIssue}`, identical to the two
  existing callers.

## What does not change

No new computation, no new permission gate (drill-through opens the same engagement record
`rate.view` already governs at the detail-screen level — the register's own `rate.view` gate at
the page level is unaffected), no schema change, no new route. `docked` mode and the overlay
`onClose` path are untouched — the one production mount (`IssueWorkspace.tsx:2660`) already runs
docked, so there is no overlay to close before the drawer opens.

## Testing

No new scenario. The behavior is a UI wiring change — `onSelect` is called with an id, and what
happens after that (the unsaved-work guard, the view switch, the filter adjustment) is
`revealIssue`'s own already-proven logic, exercised by the two existing callers. A scenario would
be re-proving `revealIssue` under a third name, not proving anything new.

## Risk

Low, same class as the original v1 page: additive, no reducer arm touched, no write action
possible from this page before or after. The one thing worth checking by hand once a browser is
available again: that clicking a row in each of the four tabs — not just "All SOWs" — reaches the
right engagement, since `r.engagement` is computed once in the shared `rows` memo and reused
by every tab's own filtered/mapped list.
