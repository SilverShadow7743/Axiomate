# CR approval join — implementation plan

Follows `docs/plans/2026-09-01-cr-approval-join-design.md`, approved as written. Read-side join
only: no reducer change, no new `Action`, no schema change. Ordering follows pure logic first,
then the two UI call sites that consume it, then the scenario that proves the whole thing —
each step provable before the next depends on it.

## Step 1 — `lib/approval.ts`: extract and add the gate function

`ApprovalsBlock.tsx:47-50` currently computes, inline:

```ts
const applicable = useMemo(
  () => ISSUE_STATUSES.flatMap((s) => rulesFor(state.model.approvalRules, issue.type, s)),
  [state.model.approvalRules, issue.type],
)
```

Move this to a named export in `lib/approval.ts`, beside `rulesFor` (~line 99):

```ts
export function applicableApprovalRules(rules: ApprovalRule[], workType: string): ApprovalRule[] {
  return ISSUE_STATUSES.flatMap((s) => rulesFor(rules, workType, s))
}
```

This needs `ISSUE_STATUSES` imported into `lib/approval.ts` from `./types` — it is not imported
there today (only `IssueStatus`, the type, is). Then add the gate function, using the newly
exported one:

```ts
export type ApprovalGateStatus = 'not-applicable' | 'not-asked' | 'open' | 'approved' | 'rejected'

export function issueApprovalGate(
  rules: ApprovalRule[],
  approvals: Record<string, Approval>,
  issue: { id: string; type: string },
): ApprovalGateStatus {
  const applicable = applicableApprovalRules(rules, issue.type)
  if (!applicable.length) return 'not-applicable'

  const mine = approvalsFor(approvals, issue.id).filter((a) =>
    applicable.some((r) => r.id === a.ruleId),
  )
  if (!mine.length) return 'not-asked'

  const open = mine.find((a) => !a.decision)
  if (open) return 'open'

  // `approvalsFor` sorts newest first, so the first decided entry is the most recent —
  // matching ApprovalsBlock's own `mine.find((a) => a.decision)` precedent for "settled".
  const decided = mine.find((a) => a.decision)!
  return decided.decision === 'approved' ? 'approved' : 'rejected'
}
```

**Verification:** `npx tsc --noEmit` — confirms `ApprovalsBlock.tsx` still compiles once its
inline `applicable` is replaced by the import (step 3 does the replacement; this step alone only
needs the new file to type-check standalone, which `tsc --noEmit` across the whole project
covers).

## Step 2 — `lib/changeRequest.ts`: add the lookup

Beside `contractedPosition` (~line 176), a one-line addition:

```ts
/** The live priced record linked to an issue, if any. */
export function changeRequestFor(changes: ChangeRequest[], issueId: string): ChangeRequest | null {
  return changes.find((c) => !c.deletedAt && c.issueId === issueId) ?? null
}
```

No new import needed — `changes.ts` already has everything this touches in scope.

**Verification:** `npx tsc --noEmit`.

## Step 3 — new scenario steps on `P` (provable before either UI step)

`scripts/scenario-validation.ts`'s scenario `P` (~line 1306-1397) gets three new steps inserted
after the existing rejection check (after line 1382's `blockedAfterRejection`, before the `good`
computation at line 1384), driving the two new pure functions directly — no component needed to
prove this layer:

1. **Before any approval requested** (against `staffed`, before `asked`'s `requestApproval`
   step runs): confirmed by reading scenario O (~line 1273-1279), `BASE` carries no SOW under
   this engagement — O derives its own with `upsertSow` before raising a priced `ChangeRequest`
   against it, rather than relying on one existing in the shared fixture. `P` does the same:
   `const engagementId = Object.values(staffed.nodes).find((n) => n.kind === 'engagement')!.id`,
   then `upsertSow` (same shape as O's, a fresh reference so O's own `'SOW-O-1'` is never
   touched — e.g. `'SOW-P-1'`), then `upsertChangeRequest` with `sowId` from that and
   `issueId: crId`, `submit: false`. This never touches `BASE` itself — `staffed` is already a
   derived state local to `P`'s own closure — so no other scenario's assertions are at risk.
   Assert `issueApprovalGate(staffed.model.approvalRules, staffed.approvals, { id: crId, type:
   'Change Request' })` reads `'not-asked'` (no approval requested yet against `staffed`, the
   state before `asked`).
2. **After the sponsor approves** (against `decided`, the state from the existing step 5):
   assert `issueApprovalGate(...)` on `decided` reads `'approved'`, and separately
   `changeRequestFor(Object.values(decided.changes), crId)?.status` reads whatever status the
   priced record was left in by step 1 (still `'Submitted'` unless also decided — the two are
   independent, which is the point; do not decide the priced record here, to prove the screens
   can disagree exactly as the design says they legitimately may).
3. **An issue type with no approval rule at all** (any `BASE` issue, e.g. `OAPIL-1`): assert
   `issueApprovalGate(BASE.model.approvalRules, BASE.approvals, { id: 'OAPIL-1', type:
   BASE.issues['OAPIL-1'].type })` reads `'not-applicable'`, and `applicableApprovalRules(BASE
   .model.approvalRules, BASE.issues['OAPIL-1'].type)` is `[]`.

Update `P`'s own `actual`/`stops`/`impact` text (the return block, ~line 1389-1395) to describe
the join: `stops` moves from *"the two paths are not yet joined"* to naming that each side now
reads the other's live state while remaining procedurally independent by design — using the
design doc's own wording as the source, not reinvented here. `verdict` stays `PARTIAL` — the
blindness is fixed, nothing about the procedural separation changed, and the design doc is
explicit that it was never meant to.

**Verification:** `npm run validate:scenarios` — scenario `P` still reports (count unchanged,
this is the same id strengthened in place, matching the O/Q/S precedent this session), 0 FAIL,
new assertions passing.

**Detail likely to be gotten wrong:** the new SOW's reference must not collide with `'SOW-O-1'`
— scenarios run against independent derivations of `BASE`, not a shared mutated fixture, so a
collision would not actually break anything technically, but a distinct reference (`'SOW-P-1'`)
keeps the two scenarios' output readable on their own terms if either is ever read side by side.

## Step 4 — `ApprovalsBlock.tsx`: render the priced-record line (delivery side)

Replace the inline `applicable` computation (lines 47-50) with the imported function:

```ts
import { applicableApprovalRules, approvalsFor, issueApprovalGate, rulesFor, ... } from '@/lib/approval'
// (issueApprovalGate is not actually called here — ApprovalsBlock renders the raw ChangeRequest,
// not the gate status; issueApprovalGate is CommercialPanel's need, in step 5)

const applicable = useMemo(
  () => applicableApprovalRules(state.model.approvalRules, issue.type),
  [state.model.approvalRules, issue.type],
)
```

Also import `changeRequestFor` and `type ChangeRequest` from `@/lib/changeRequest`. After the
existing `if (!applicable.length && !approvals.length) return null` guard (line 60), inside the
returned `<section>`, add one block that only renders when `applicable.length`:

```tsx
{applicable.length > 0 && (() => {
  const linked = changeRequestFor(Object.values(state.changes), issue.id)
  return (
    <p className="prov appr-cr-link">
      {linked
        ? `Priced as a change request: ${linked.status}, ${linked.effortHours}h · ${linked.currency} ${linked.value.toLocaleString()}.`
        : 'No priced change request raised for this yet.'}
    </p>
  )
})()}
```

Placed after the rule loop (after the closing of the `{applicable.map(...)}` block, ~line 179),
before the "orphaned approvals" block at line 181 — it belongs with the rule-gated content, not
mixed into the leftover-approvals section.

**Verification:** `npx tsc --noEmit`; `npm run audit:a11y` (a new text line, no new interactive
control — should pass without changes, but the standing gate runs it regardless since this is a
real component edit).

## Step 5 — `CommercialPanel.tsx`: render the gate status (commercial side)

`changeRequestIssues` (line 150-153) already returns full `IssueRecord[]` from `issuesUnder`
(`lib/engagement.ts:156-171`), which already carries `.type` — no change needed to that
computation itself.

Widen `Changes`'s prop type for `candidateIssues` (line 470) from `{ id: string; subject: string
}[]` to `{ id: string; subject: string; type: string }[]`. The value passed at the call site
(line 277, `candidateIssues={changeRequestIssues}`) needs no change — `changeRequestIssues` is
already `IssueRecord[]`, which structurally satisfies the widened type today and will satisfy it
once widened, since no intermediate literal triggers TypeScript's excess-property check.

Add a new prop to `Changes`, computed once in `CommercialPanel` (which has full `state`) rather
than threading `state.model.approvalRules`/`state.approvals` down — matching the narrow-prop
precedent `Milestones` set with `today`/`warnBeforeDays`:

In `CommercialPanel`, beside `changeRequestIssues` (~line 153):

```ts
import { issueApprovalGate } from '@/lib/approval'

const changeGateStatus = useMemo(
  () => new Map(changeRequestIssues.map((i) => [i.id, issueApprovalGate(state.model.approvalRules, state.approvals, i)])),
  [changeRequestIssues, state.model.approvalRules, state.approvals],
)
```

Pass it to `<Changes ... gateStatus={changeGateStatus} .../>` (~line 277, alongside
`candidateIssues`).

In `Changes`'s prop destructuring (line 456-477), add `gateStatus: Map<string,
import('@/lib/approval').ApprovalGateStatus>` (or a named import at the top of the file — prefer
importing `type ApprovalGateStatus` at the top alongside the existing `ChangeRequest` import from
`@/lib/changeRequest`, not an inline `import()` type).

In the table row (line 521-526), after the existing `→ {issueSubject}` div, add:

```tsx
{c.issueId && (() => {
  const gate = gateStatus.get(c.issueId)
  const label =
    gate === 'not-asked' ? 'work not yet cleared to start'
    : gate === 'open' ? 'awaiting a decision to start'
    : gate === 'approved' ? 'cleared to start'
    : gate === 'rejected' ? 'start declined'
    : null
  return label ? <div className="est-block-note">{label}</div> : null
})()}
```

**Verification:** `npx tsc --noEmit`; `npm run audit:a11y`.

## Step 6 — standing gate, commit, staged deploy

```
npx tsc --noEmit
npm run validate:scenarios      # scenario P strengthened in place, 0 FAIL, count unchanged
npm run audit:a11y              # two new text lines, no new controls — expect 0
npm run build
```

One commit — steps 1-5 are meaningless in isolation (the pure functions have no caller until the
UI steps land, and the UI steps don't compile without the pure functions), so they land together
rather than as separate commits, unlike features this session with a genuinely separable riskiest
step. There is no single step here that changes a code path which currently always succeeds —
every change here is additive (new functions, new optional render branches) — so this plan has no
step of the CR-join/resolution-notice/dismiss-log kind that needs its own isolated commit
boundary for blast-radius reasons.

Then the established staged-deploy recipe: `git archive $SHA` → fresh dir under
`$HOME/.claude/jobs/de2e6ea5/tmp/deploy-<sha>` → `npm ci` → `prisma generate` → `npm run build` →
`npx prisma migrate status` (expect "Database schema is up to date!", no schema touched here) →
`MSYS_NO_PATHCONV=1 python scripts/package-release.py .next/standalone release.zip --extra
.next/static:.next/static --extra public:public` → `az webapp deploy` → health poll on
`"database":"connected"` → verify via grep-ing a distinctive new string (e.g.
`"No priced change request raised for this yet"` or `"cleared to start"`) inside a deployed
`.next/static/chunks/*.js` or `.next/server/chunks/*.js` file.

## The step carrying the most regression risk

None of steps 1-5 modifies a path that currently always succeeds — every change is additive
(new exports, new optional UI branches gated on data that is usually absent). The closest thing
to a risk is **step 3's scenario edit**, because it is the one step touching an *existing*,
already-passing scenario body rather than adding new code: a mistake there could make `P` report
a false `FAIL` (blocking the gate on a correct implementation) or, worse, a false continued
`PASS` on a `stops` string that no longer matches what the code does (the exact staleness bug
scenario `Q` had before this session corrected it). Reread the edited scenario's full return
block once written, the way `Q`'s and `S`'s corrections were each reread this session, before
trusting the gate's green result.

## What would send this back

- If more than one live `ChangeRequest` ever links to the same `issueId` in practice — the design
  doc flagged this as open. `changeRequestFor`'s "first match" behavior would then silently pick
  one rather than surfacing the ambiguity. Not expected to occur given today's UI only ever
  raises one per issue via the picker, but if scenario P's own new steps accidentally create two,
  that is a sign the assumption needs revisiting before shipping, not a scenario-writing mistake
  to just work around.
