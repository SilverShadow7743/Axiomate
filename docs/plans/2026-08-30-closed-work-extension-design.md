# The closed-work extension — a reason and the week's approval, as promised

**Status: approved 2026-08-30** (one AskUserQuestion decision; small enough that this doc
carries its own plan). Closes TW1's last stop: the window's refusal has always promised that
"hours genuinely spent on closed work can still be recorded, with a reason and an approval to
reopen the window — that is what the extension is for" (lib/timeWindow.ts:232), and no UI or
reducer path delivered it. The 2026-08-22 grace design deferred it as "a separate mechanism,
register-worthy on its own"; the user chose the smaller honest reading instead.

## The decision

**Reason + week approval** — over an explicit TimeExtension record (stronger pre-approval
governance, a full phase) and over keep-refusing (status churn as the only route). A
closed-issue entry is ALLOWED when a justification is given; the justification is stored on
the entry exactly as the grace gate stores lateness reasons; and the week's approver sees it
at decision time — the surface that ALREADY lists justified entries (TimesheetPanel:292).
The timesheet approval IS the promised approval: the same two-person pattern the grace gate
established ("the week's decider sees that reason at approval time, which is the second
person the rule asks for").

## What changes, where

1. **lib/workspace.ts `addTime`**: the justification is read BEFORE the window gate; a
   verdict of kind `'issue-closed'` WITH a justification proceeds instead of refusing —
   warnings gain "Recorded on closed work — the reason travels with the week to its
   approver", the justification is stored, and the audit line carries "· on closed work".
   Without a justification the existing refusal stands (its message already asks for one).
   Every other refusal kind stays a refusal — `'issue-closed'` is the ONLY extendable kind.
2. **`updateTime`**: the destination window check gets the same exception when the edited
   entry carries a justification — the two-step stays shut for the unjustified.
3. **components/TimeTab.tsx**: `needsReason` also fires when the issue's status is terminal,
   with its own hint wording, so the reason box appears before the refusal rather than after.
4. **TW1** extends: closed + reason → accepted through the reducer with the justification
   stored and the warning carried; closed + no reason → still refused; the edit two-step with
   a justification → allowed onto the closed issue, without → refused. If all drive, TW1's
   verdict becomes an EARNED PASS — the stop it was PARTIAL for is gone.

No new records, no migration, no persistence work (justification is an existing column).

## What never changes

`before-window` and `not-permitted` refusals are not extendable — the reason box reopens
CLOSED work only. Frozen weeks stay frozen (the freeze check runs regardless). The pure
module keeps refusing; the exception is a reducer-level gate beside the grace gate it mirrors.

## Verification

`npx tsc --noEmit` → `npm run validate:scenarios` (188, 0 FAIL, TW1 PASS earned) → audits
unchanged → build → staged deploy → live: log an hour against a closed issue with a reason,
see it in the week, see the reason listed on the approver's queue.

## What would send this back

- Approvers wanting to reject the ENTRY rather than the week — that is the explicit
  TimeExtension mechanism after all; reopen the decision.
- The audit marker proving insufficient for finance scrutiny — same escalation.
