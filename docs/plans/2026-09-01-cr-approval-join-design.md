# CR approval join — design

## The gap

Scenario `P` ("A change request is approved") has read `PARTIAL`/P2 all session. Its own `stops`
text names the gap precisely: *"at this issue-shaped change only. Approving a `ChangeRequest`
DOES move the contracted position now — baseline plus approved movements, computed on read
(CR1) — and the two paths are not yet joined: this scenario approves a work item, not a
variation."*

Two real, separate decisions exist today:

- **`APPR_CR_START`** (`lib/approval.ts`) — an `Approval` gating a Change-Request-typed *issue*'s
  move to `In Progress`. Decided by `ROLE_ENGAGEMENT_LEAD` or `ROLE_CLIENT_SPONSOR`, asking *"Do
  you approve this change, its effort and its effect on the agreed scope?"* Rendered by
  `ApprovalsBlock`, under the issue's status field.
- **`decideChangeRequest`** (`lib/changeRequest.ts`) — decides the **priced** `ChangeRequest`
  record (linked via `issueId`) to `Approved`/`Rejected`. Only `Approved` counts toward
  `contractedPosition` (the SOW's baseline plus approved movements). Rendered by
  `CommercialPanel`'s `Changes` table.

These ask the same substantive question — same effort, same scope, usually the same decider
role — through two screens with no visibility into each other. A reviewer in `CommercialPanel`
cannot tell whether delivery already started without the price being agreed; a consultant on the
issue cannot tell whether a priced record exists at all, or what it says.

## What this is not

This is not a proposal to merge the two decisions, or to make one drive the other. A firm may
legitimately start delivery before the price is finalised ("at risk"), or price a change before
delivery begins — both are ordinary in consulting, and forcing them to move together would break
a real, legitimate sequence for the sake of removing one redundant question. The two decisions
stay exactly as procedurally independent as they are today.

What closes is the *blindness*, not the separation: each screen learns to show the other's
current state. This is a read-side join only — no reducer change, no new `Action`, no schema
change.

## Data model

Two new pure functions, shaped like `milestoneRisk()` and `describeContracted()` already are —
a typed fact returned for the caller to render, never a rendered string and never a score.

`lib/approval.ts` gains a named export pulled out of `ApprovalsBlock`'s existing inline
computation (`ISSUE_STATUSES.flatMap((s) => rulesFor(state.model.approvalRules, issue.type,
s))`), so the "which rules could ever gate this issue's type" logic has one home instead of two:

```ts
export function applicableApprovalRules(rules: ApprovalRule[], workType: string): ApprovalRule[]
```

Built on that, the actual cross-reference fact:

```ts
export type ApprovalGateStatus = 'not-applicable' | 'not-asked' | 'open' | 'approved' | 'rejected'

export function issueApprovalGate(
  rules: ApprovalRule[],
  approvals: Record<string, Approval>,
  issue: { id: string; type: string },
): ApprovalGateStatus
```

`'not-applicable'` when no rule matches this issue's type at all (most issues); `'not-asked'`
when a rule applies but nobody has requested an approval yet; `'open'` when one is pending a
decision; `'approved'`/`'rejected'` once decided. Multiple approval events against the same rule
(a rejection followed by a fresh request) resolve to the most recent, matching `ApprovalsBlock`'s
own `mine.find((a) => !a.decision)` / `mine.find((a) => a.decision)` precedent.

`lib/changeRequest.ts` gains the mirror lookup:

```ts
export function changeRequestFor(changes: ChangeRequest[], issueId: string): ChangeRequest | null
```

The live (non-deleted) priced record linked to an issue, or `null`. A one-line filter, not worth
more ceremony than that.

## Wiring

**Delivery side — `ApprovalsBlock` (`components/ApprovalsBlock.tsx`).** It already receives
`state` and `issue` in full. When `applicable.length` (this issue's type is subject to at least
one approval rule — the existing condition, unchanged), also compute
`changeRequestFor(Object.values(state.changes), issue.id)` and render one additional line:

- A linked record exists → its status and figures, e.g. *"Priced as a change request: Submitted,
  8h · £4,000."*
- None exists → *"No priced change request raised for this yet."* — an honest absence, not a
  guess, matching the "never invent a fact nobody stated" rule this codebase applies everywhere
  else (resolution notice's `suggestedContact: null`, milestone risk's `noDate` case).

Both only appear when `applicable.length` — an issue with no approval rule at all gets no new
UI, since the cross-reference exists to serve exactly the case an approval gate is in play.

**Commercial side — `CommercialPanel`'s `Changes` (`components/CommercialPanel.tsx`).**
`changeRequestIssues` (already computed, feeding `candidateIssues={id, subject}` today) widens to
also carry `type`. `Changes` calls `issueApprovalGate(state.model.approvalRules, state.approvals,
issue)` per linked change and renders a short status word beside the existing `→ {issueSubject}`
line:

- `not-asked` → *"work not yet cleared to start"*
- `open` → *"awaiting a decision to start"*
- `approved` → *"cleared to start"*
- `rejected` → *"start declined"*
- `not-applicable` → nothing (most linked issues carry no gate at all — plain Tasks, say)

`Changes` does not gain the full `WorkspaceState` prop — `CommercialPanel` computes the per-issue
gate once (it already has `state` in full) and passes a small `Map<string, ApprovalGateStatus>`
down, following the same narrow-prop precedent `Milestones` already set with `today` and
`warnBeforeDays` rather than threading `state` itself into every subcomponent.

## Testing

Extend scenario `P` in place rather than adding a new id — the gap it already describes is
exactly what this closes. After the existing five steps (unapproved → asked → self-approval
refused → wrong-role refused → sponsor approves → work starts; plus the rejection case), add:
raise a priced `ChangeRequest` linked to the same issue at three points — before any approval is
requested, after the sponsor approves, after a rejection — and assert `issueApprovalGate` and
`changeRequestFor` read back the right fact at each point. Also cover an issue whose type carries
no approval rule at all, confirming `applicableApprovalRules` returns `[]` and the UI condition
correctly shows nothing.

`P`'s own verdict text changes from *"the two paths are not yet joined"* to something like:
*visibly joined — each screen now shows the other's state — but still deliberately separate,
because starting delivery before a price is agreed is a legitimate sequence in consulting, not a
bug this should close.* Whether the verdict itself moves from `PARTIAL` is a judgment for the
plan/implementation pass once the corrected scenario body is written — the blindness is fixed,
the procedural separation is not, and was never meant to be.

## What would send this back

- If `ApprovalsBlock` or `CommercialPanel`'s existing prop shapes turn out to make a narrow
  `Map`-based prop awkward compared to just widening what's threaded through — a plan-stage
  finding, not assumed here.
- If more than one `ChangeRequest` is ever found linked to the same `issueId` (today's model
  doesn't prevent raising two) — `changeRequestFor` returning a single record would then be
  silently wrong rather than merely incomplete, and needs deciding before implementation: most
  recent by `requestedAt`, or surface the ambiguity instead of picking one.
