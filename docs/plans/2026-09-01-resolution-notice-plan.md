# Resolution notice — implementation plan

Follows `docs/plans/2026-09-01-resolution-notice-design.md`, approved via chat design review.

**Ordering principle:** pure logic first — `resolutionNotices()` has no clock, no I/O, no
framework, and is driven directly by a new scenario before anything calls it. Then the plumbing
that returns what's already computed (still no new I/O). Then the one step that adds a genuinely
new kind of side effect to the interactive save path — isolated on its own, because it is the
step every other status-changing save now runs through. UI last, since it depends on everything
below it being correct and cannot itself be scenario-tested.

Three corrections to the design doc, found while grounding this plan — noted here rather than
silently applied, since the design doc's own self-review missed them:

1. **`ResolutionNotice` has no `displayId` field.** `lib/tree.ts:122` shows `displayId: issue.id`
   for every ordinary issue row — `Issue.id` (minted by `nextIssueId`, `lib/workspace.ts:1495`,
   e.g. `OAPIL-180`) already IS the human-facing string. A separate `displayId` would just
   duplicate `issueId`. Dropped.
2. **`resolveOperatorAddress` cannot live in `lib/reports/delivery.ts`.** That file is imported
   by `lib/config.ts`, which `components/ConfigWorkspace.tsx` (`'use client'`) pulls in. The
   helper needs `currentActor()` from `lib/identity.ts`, which starts with `import 'server-only'`
   — importing it into `delivery.ts` would break every client bundle that touches
   `ConfigWorkspace.tsx`. It lives in the new `lib/reports/resolutionNotice.ts` instead, which
   has exactly one consumer (`lib/db/persist.ts`, already server-only) plus `lib/db/schedule.ts`
   importing the one shared helper — both server-only contexts.
3. **`PersistResult` gains one new field, not two.** `resolutionNotices()`, the config check
   (`reportDelivery.resolutionNoticeEnabled`), the mailbox-to-send-AS resolution
   (`state.model.intake`), and the destination resolution (`packDestination` / operator
   fallback) are bundled into one `notifyBundle()` call that returns either everything route.ts
   needs to actually send, or `null` when any part of that isn't ready (config off, no notices,
   no intake mailbox, no destination). `PersistResult.notify: NotifyBundle | null` is the one
   addition — simpler than the design's `resolutionNotices` + `reportDelivery` pair, and it
   means route.ts never has to re-derive "am I actually supposed to send" from three separate
   fields itself.

## Steps

### 1. `lib/reports/resolutionNotice.ts` (new) + `lib/reports/delivery.ts` + scenario `RN1`

**New file**, mirroring `lib/reports/clientPack.ts`'s header-comment style (what this is built on,
what it deliberately withholds):

```ts
import type { WorkspaceState } from '../workspace'
import type { AuditEntry } from '../types'
import { scopeChainOf } from '../workspace'
import { currentActor } from '../identity'
import type { ReportDeliveryConfig } from './delivery'

export interface ResolutionNotice {
  issueId: string       // == Issue.id, already the display string (see correction 1 above)
  subject: string
  clientName: string
  /** A directory contact who might be the one to tell, when one resolves. Never guessed. */
  suggestedContact: string | null
}

/** The `'client'` ancestor of a record, or null — the same shape as `projectOf` (workspace.ts). */
function clientNodeOf(state: WorkspaceState, id: string): string | null {
  for (const scopeId of scopeChainOf(state, id)) {
    if (state.nodes[scopeId]?.kind === 'client') return scopeId
  }
  return null
}

export function resolutionNotices(state: WorkspaceState, newAudit: AuditEntry[]): ResolutionNotice[] {
  const out: ResolutionNotice[] = []
  for (const entry of newAudit) {
    if (entry.field !== 'status' || entry.to !== 'Awaiting client confirmation') continue
    const issue = state.issues[entry.rowId]
    if (!issue || issue.deletedAt) continue
    const clientId = clientNodeOf(state, issue.id)
    if (!clientId) continue
    const client = state.nodes[clientId]
    const contact = Object.values(state.model.people).find(
      (p) =>
        p.clientScopeId === clientId &&
        p.email &&
        p.roleIds.some((r) => r === 'ROLE_CLIENT_SPONSOR' || r === 'ROLE_CLIENT_LEAD' || r === 'ROLE_CLIENT_USER'),
    )
    out.push({
      issueId: issue.id,
      subject: issue.subject,
      clientName: client?.name ?? clientId,
      suggestedContact: contact?.email ?? null,
    })
  }
  return out
}

/** Same expression `lib/db/schedule.ts` used inline (correction 2 above) — one copy, not two. */
export function resolveOperatorAddress(state: WorkspaceState, config: ReportDeliveryConfig): string | null {
  return (
    config.packDestination ||
    Object.values(state.model.people).find(
      (p) => p.name.trim().toLowerCase() === currentActor().name.trim().toLowerCase() && p.email,
    )?.email ||
    null
  )
}

export interface NotifyBundle {
  notices: ResolutionNotice[]
  /** The address to send AS — the first enabled intake mailbox. */
  mailbox: string
  /** The address to send TO — an internal reviewer, never the client directly. */
  dest: string
}

/** Everything route.ts needs to send, or null when any part of that isn't ready. */
export function notifyBundle(state: WorkspaceState, newAudit: AuditEntry[]): NotifyBundle | null {
  if (!state.model.reportDelivery.resolutionNoticeEnabled) return null
  const notices = resolutionNotices(state, newAudit)
  if (!notices.length) return null
  const mailbox = state.model.intake.find((m) => m.enabled)?.address
  if (!mailbox) return null
  const dest = resolveOperatorAddress(state, state.model.reportDelivery)
  if (!dest) return null
  return { notices, mailbox, dest }
}
```

Field names confirmed by reading the real interfaces while writing this plan: `Person`
(`lib/config.ts:234`) has `roleIds: string[]`, `email?: string`, `clientScopeId?: string | null`
— and no `deletedAt` at all; directory entries are not soft-deletable the way records are, so no
such check belongs in the `find()` above. The issue type is `IssueRecord`
(`lib/workspace.ts:237`, aliased as `Issue` in `state.issues`), with `subject: string`,
`parentId: string`, `deletedAt: string | null`. `HierarchyNode` (`lib/workspace.ts:217`) has
`kind: NodeKind`, `name: string`, `deletedAt: string | null`.

**`lib/reports/delivery.ts`**: add `resolutionNoticeEnabled: boolean` to `ReportDeliveryConfig`
(after `packsEnabled`), to `DEFAULT_REPORT_DELIVERY` (`false`), and to `parseReportDelivery`
(`resolutionNoticeEnabled: r.resolutionNoticeEnabled === true` — this is the detail most likely
to be silently missed: `parseReportDelivery` is an explicit allow-list, confirmed by reading it
in full; a field not named here parses to nothing, silently, however the config was stored).

**New scenario `RN1`** in `scripts/scenario-validation.ts`, placed in the same file section as
`RD1`/`CR1` (report-delivery-adjacent), driving `resolutionNotices()` directly and purely — no
`notifyBundle`, no `currentActor`, no env dependency, matching the design doc's own "Testing"
section:

- An issue moved to `Awaiting client confirmation` with a directory contact that resolves
  (`ROLE_CLIENT_USER`, matching `clientScopeId`, an email) → one notice, `suggestedContact` set.
- The same transition with no resolvable contact → notice present, `suggestedContact: null`.
- An issue moved to a *different* status → no notice for it.
- A no-op status patch (same value as before) → `updateIssue`'s own `changed` filter
  (`lib/workspace.ts:2537-2540`) writes no audit row at all for an unchanged field, so
  `newAudit` never carries the entry in the first place — assert this explicitly by constructing
  the no-op patch and checking the resulting notice list stays empty, so a future change to that
  filter's behavior breaks this feature's own test, not just silently produces duplicate notices.

Build `newAudit` for the scenario the same way `persist.ts` does — take the state before the
`updateIssue` actions and after, and slice `after.audit` at `before.audit.length` — rather than
hand-constructing `AuditEntry` objects, so the scenario is proving the real integration between
`updateIssue`'s audit shape and `resolutionNotices`' filter, not a fabricated stand-in for it.

**Verify:** `npx tsc --noEmit` → `npm run validate:scenarios` (`RN1` PASS, count 202 → 203, 0
FAIL, nothing existing regresses).

**Commit 1**, standalone: this whole step is pure and self-contained, provable before anything
in the app calls it.

### 2. `lib/db/persist.ts` widening + `lib/db/schedule.ts` reuse

**`lib/db/persist.ts`**: `PersistResult` (line ~57) gains `notify: NotifyBundle | null`. The
failure-branch return (line ~260-277) sets it explicitly to `null` — not left optional — so
TypeScript catches any future return site that forgets it. The success-branch return (line ~278)
computes it: `notify: notifyBundle(current, newAudit)`. Import `notifyBundle` and `NotifyBundle`
from `../reports/resolutionNotice`.

**`lib/db/schedule.ts`**: replace the inline expression at lines 226-229
(`config.packDestination || Object.values(state.model.people).find(...)`) with
`resolveOperatorAddress(state, config)`, imported from `../reports/resolutionNotice`. Pure
refactor — the expression is byte-for-byte identical, just named and shared. No behavior change,
so nothing here should move any scenario's verdict.

**Verify:** `npx tsc --noEmit` → `npm run validate:scenarios` (count and every verdict unchanged
from step 1's 203 — this step adds no new scenario and changes no observable behavior) →
`npm run build`.

**Commit 2**: both files together — the widening and its first real reuse are one unit; splitting
them would leave `persist.ts`'s new field with no consumer proving it compiles against a real
caller shape until the next commit.

### 3. `app/api/workspace/route.ts` — RISKIEST STEP

This is the one step that adds a new kind of I/O to the interactive dispatch path — every save
that changes an issue's status now runs through this code, not just the ones that happen to
trigger a notice. If this is wrong, the failure lands on every consultant using the Tree, Board
or DetailPanel to change a status, not just on this feature.

After `const result = await persistActions(...)` (line ~211) and before the response is built:

```ts
if (result.ok && result.notify) {
  try {
    for (const n of result.notify.notices) {
      const subject = `Ready to tell the client — ${n.issueId}`
      const text =
        `${n.issueId} — ${n.subject} — moved to Awaiting client confirmation for ${n.clientName}.` +
        (n.suggestedContact ? `\n\nSuggested contact: ${n.suggestedContact}` : '')
      const sent = await sendAsMailbox(result.notify.mailbox, result.notify.dest, subject, text)
      if (!sent.ok) {
        console.error(`resolution notice failed for ${n.issueId}: ${sent.status} ${sent.detail}`)
      }
    }
  } catch (err) {
    console.error('resolution notice failed:', err instanceof Error ? err.message : String(err))
  }
}
```

placed strictly **after** `persistActions` has already returned — the transaction that saved the
status change closed before this runs, matching `lib/db/schedule.ts`'s own explicit reasoning
for why Graph HTTP happens after `prisma.$transaction` returns (its comment, verbatim: *"Graph
HTTP inside a Serializable transaction would hold locks through network I/O and race its 30s
timeout"*) — cite that exact precedent in the commit message, don't just assert the same rule
independently.

The `try/catch` must never let a failed send turn a successful save into an error response — the
outer `return NextResponse.json(result, ...)` is untouched by anything inside this block.

**The detail most likely to be gotten wrong**: `result` (the object about to be JSON-serialized
back to the browser) now carries `notify`, which includes an internal mailbox address, an
internal reviewer's address, and — via `suggestedContact` — a client contact's email. None of
that is secret, but none of it is something the frontend reads or should see in its network tab
either. Strip it before responding:

```ts
const { notify, ...publicResult } = result
return NextResponse.json(publicResult, { status: result.ok ? 200 : 409 })
```

Import `sendAsMailbox` from `@/lib/mail`.

**Verify:** `npx tsc --noEmit` → `npm run build` → manual read-through confirming (a) the notify
block is textually after `persistActions` resolves and outside any transaction, (b) no path
through this block can change `result.ok` or throw past the route's own outer `catch`, (c) the
stripped `publicResult` is what's actually returned, not the raw `result`. Not scenario-testable
(this is the one step the design doc's own Testing section excludes, matching how the client-pack
delivery's Graph call is untested by the harness too) — this manual check is the real
verification for this step.

**Commit 3**, standalone: named as the riskiest step specifically so an isolated revert is
available if the shared dispatch path misbehaves in a way the gate above didn't catch.

### 4. `components/ConfigWorkspace.tsx` + scenario `S`'s text

**`ConfigWorkspace.tsx`** (~line 1870-1920): a third checkbox beside `imsEnabled`/`packsEnabled`,
identical shape:

```tsx
<input
  type="checkbox"
  checked={state.model.reportDelivery.resolutionNoticeEnabled}
  onChange={(e) => onConfig({ k: 'setReportDelivery', patch: { resolutionNoticeEnabled: e.target.checked } })}
/>
```

with a label matching the section's existing register-of-fact tone (e.g. "Prompt somebody
internally when a record moves to Awaiting client confirmation, so the client can be told").

**Scenario `S`** in `scripts/scenario-validation.ts`: update `actual`/`stops`/`severity` to
describe what's now true, following exactly the precedent set when scenario `O` was strengthened
for the CR-issue-join feature (text corrected in place, verdict changed only if genuinely
earned). Per the design doc's own honesty rule, this is **not** a flip to PASS — the client is
still not messaged directly. Read the current `S` text (`scripts/scenario-validation.ts`,
`'S'` section) while writing the replacement; the shape should read roughly: the status moves and
the audit trail records it as before, and now — when `resolutionNoticeEnabled` is on — an
internal reviewer is prompted by email with the issue, the client and a suggested contact when
one resolves, so telling the client no longer depends on somebody remembering unprompted. `stops`
becomes something like "at the reviewer — the notice reaches a person, not the client; forwarding
it is still a manual step, same caution the client-pack feature already applies." Severity: judge
by how much of the original P2 impact remains — likely stays P2, since the gap ("nobody is
prompted") is closed but the gap ("the client isn't told automatically") is not; state which is
which explicitly in `impact`, don't average them into a vague middle verdict.

**Verify:** `npx tsc --noEmit` → `npm run validate:scenarios` (204 total unchanged in count — `S`
already existed, only its text/severity change — confirm 0 FAIL) → `npm run audit:a11y` (real UI
change: the new checkbox) → `npm run build`.

**Commit 4**: both changes together — the UI toggle and the scenario narrative describing what
it does are one statement about the same fact, and splitting them would leave one temporarily
contradicting the other in the commit history.

### 5. Standing gate + staged deploy

Full gate: `npx tsc --noEmit` → `npm run validate:scenarios` (203 scenarios if `RN1` is the only
addition — confirm the exact final count when running it, since `S`'s update doesn't add one —
`0 FAIL`) → `npm run audit:a11y` (`0`) → `npm run build`. Then the established staged-deploy
recipe: `git archive` the four commits → fresh dir under
`$HOME/.claude/jobs/de2e6ea5/tmp/deploy-<sha>` → `cp .env` → `npm ci` → `prisma generate` →
`npm run build` → `npx prisma migrate status` (expect: up to date — no schema change anywhere in
this feature) → `MSYS_NO_PATHCONV=1 python scripts/package-release.py .next/standalone
release.zip --extra .next/static:.next/static --extra public:public` → `az webapp deploy` →
health poll on `"database":"connected"` → chunk-grep verification against the local deploy dir
for a distinctive new string, e.g. `"resolutionNoticeEnabled"` or `"Ready to tell the client"`.

## What would send this design back

- If `newAudit` does not reliably carry exactly one row per changed field for every batch shape
  `persistActions` can produce — e.g. a rule-engine follow-up (`applyWithRules`) re-touching the
  same issue's status within one call in a way that produces more or fewer rows than the direct
  reducer path alone. Check this while writing step 1's scenario, by driving a real multi-action
  batch through `apply`/`applyWithRules` rather than assuming the single-action shape generalizes
  — surfaces at step 1, before anything depends on the assumption.
- If `Person.roleIds`, `Person.clientScopeId`, `Person.deletedAt`, `HierarchyNode.kind`, or
  `Issue.deletedAt` don't actually match the field names used in step 1's draft code above —
  surfaces immediately as a `tsc` failure at step 1, cheap to catch, but would mean the design's
  targeting description was imprecise rather than the mechanism being wrong.
- Correction 2's own risk is inverted, not open: `lib/reports/delivery.ts` is reachable from
  client code more directly than first thought — `lib/workspace.ts` also imports it (for
  `ReportDeliveryConfig`'s type in the `setReportDelivery` op signature), and `workspace.ts` is
  the core reducer every client component uses. This makes keeping `resolveOperatorAddress` out
  of `delivery.ts` more clearly correct, not less. If `npm run build`'s client bundle step ever
  throws on `server-only` after this feature lands, that means something in step 1 put
  `currentActor` somewhere reachable from `workspace.ts`'s import graph after all — verified by
  the existing `npm run build` step, no new check needed.
