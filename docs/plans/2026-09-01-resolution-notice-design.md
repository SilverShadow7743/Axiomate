# Resolution notice — design

## The gap

Scenario `S` ("An issue is resolved") in `scripts/scenario-validation.ts` has read `PARTIAL`/P2
all session: *"The status moves, the next action is recorded and N audit entries were written
with before, after and actor. No message is sent to the client."* `stops`: *"at telling the
client."*

Everything around the gap already exists — the transition, the audit trail, the mail-send
primitive (`sendAsMailbox`, `lib/mail.ts`). What's missing is the one call that connects a
status change to an outbound notice.

## What this is not

`sendAsMailbox` is called from exactly two places today: a user-composed reply
(`app/api/mail/send/route.ts`) and the scheduled batch pass (`lib/db/schedule.ts`). Nothing in
the interactive dispatch path (`app/api/workspace/route.ts` → `lib/db/persist.ts`) sends mail.
This is the first live-triggered outbound message tied to a state transition — a new class of
side effect, not a new call site into an existing flow. That is why this is designed, not just
built.

It is also not a message to the client. The existing client-pack feature (`lib/reports/
clientPack.ts`, delivered by `lib/db/schedule.ts`) sends the weekly/monthly PDF to an *internal*
`packDestination` address with the instruction "review it, then forward it to the client" — a
deliberate human check before anything client-shaped leaves the firm automatically. This design
follows that same caution: the notice goes to an internal reviewer, not to the client. Scenario
`S`'s own wording ("no message is sent to the client") is not fully closed by this — a person is
now reliably prompted, with the who/what already drafted, but the client is not messaged
automatically. The scenario write-up will say this plainly rather than claim more.

## Flow

`updateIssue`'s existing per-field audit loop (`lib/workspace.ts`, the `changed`/`log` loop
inside the `updateIssue` arm) already writes one audit row per changed field —
`{ rowId, field: 'status', from, to, at, by }` — whenever a patch changes `status`, including to
`Awaiting client confirmation`. No new audit convention is needed.

`persistActions` (`lib/db/persist.ts`) already computes `newAudit` — the rows this one call
wrote — inside `runBatch`, but does not return it. `PersistResult` gains one new field:

```ts
resolutionNotices: ResolutionNotice[]
```

computed by a new pure function in a new file, `lib/reports/resolutionNotice.ts`:

```ts
export interface ResolutionNotice {
  issueId: string
  displayId: string
  subject: string
  clientName: string
  /** A directory contact who might be the one to tell, when one resolves. Never guessed. */
  suggestedContact: string | null
}

export function resolutionNotices(
  state: WorkspaceState,
  newAudit: AuditEntry[],
): ResolutionNotice[]
```

`persist.ts` calls this with `(current, newAudit)` unconditionally — it is pure and cheap, and
`persist.ts` stays free of any notification-specific vocabulary or config knowledge. Whether
anything is *done* with the list is entirely `route.ts`'s decision.

`app/api/workspace/route.ts`'s `POST` handler, after `persistActions` returns `ok: true`: if
`state.model.reportDelivery.resolutionNoticeEnabled` and `result.resolutionNotices.length`, send
one email per notice via `sendAsMailbox` — outside any DB transaction, after the save has already
committed. A failed send is caught and logged; it never turns a successful save into an error
response. This mirrors `lib/db/schedule.ts`'s own rule that a refused send does not undo the
underlying success it is reporting on.

Reading `state.model.reportDelivery` requires `route.ts` to have it available after persisting —
`PersistResult` does not carry it today. Rather than a second `loadWorkspace` just to read one
config flag (against the same "the read happens inside the transaction" reasoning `persist.ts`'s
own header comment gives for reading state where it's already loaded, not re-fetching it after),
`PersistResult` gains a second new field: `reportDelivery: ReportDeliveryConfig`, read off
`current.model` — already in memory, no extra DB round trip, no serialization cost since this
never crosses a network boundary. `PersistResult` totals two additions: `resolutionNotices` and
`reportDelivery`.

## Destination and content

Same address as the client packs: `reportDelivery.packDestination`, falling back to the
deployment operator's own directory email if unset. That expression exists today, duplicated
inline once in `lib/db/schedule.ts` (`config.packDestination || <operator's directory email>`).
This design extracts it into one small shared helper — `resolveOperatorAddress(state, config)`,
likely in `lib/reports/delivery.ts` beside `ReportDeliveryConfig` itself — used by both the
existing pack-delivery call site and the new one, removing the near-duplicate rather than adding
a third copy.

Message shape, one per notice, plain text (matching every other `sendAsMailbox` call in this
codebase — none send HTML):

```
Subject: Ready to tell the client — OAPIL-42

OAPIL-42 — Add a second approval step — moved to Awaiting client confirmation for Oapil
Manufacturing.

Suggested contact: jane@oapil.example
```

The `Suggested contact` line is present only when one resolves, and only ever from a directory
join — never a guess. Resolution: a `Person` holding a `ROLE_CLIENT_*` role, whose
`clientScopeId` sits on the issue's ancestor chain, with a non-empty `email` — the exact join
already proven by `GA1`/`GA2` and used for the client-boundary access checks. No match → the
line is simply absent, the same "never invent a fact nobody stated" rule this codebase applies
everywhere else.

## Config

One new boolean on the existing `ReportDeliveryConfig` (`lib/reports/delivery.ts`):

```ts
export interface ReportDeliveryConfig {
  imsEnabled: boolean
  packsEnabled: boolean
  resolutionNoticeEnabled: boolean   // new
  imsRecipients: string[]
  packDestination: string
}
```

Defaults to `false` in `DEFAULT_REPORT_DELIVERY`, same as the two existing toggles — a workspace
does not start sending these until somebody turns it on. The Configuration screen
(`components/ConfigWorkspace.tsx`) gets one more checkbox beside `imsEnabled`/`packsEnabled`,
same `checked`/`onChange` → `setReportDelivery` pattern already there for the other two.

## Testing

`resolutionNotices()` is pure and takes `(state, auditEntries)` directly — no I/O, no live Graph
call needed to test it. A scenario constructs: an issue transitioning to `Awaiting client
confirmation` with a resolvable client contact (notice includes `suggestedContact`), one
transitioning with no resolvable contact (notice present, `suggestedContact: null`), one
transitioning to a *different* status (no notice), and one whose status is set to the *same*
value it already held via a no-op patch (no audit row written at all by the existing `changed`
filter, so naturally no notice — nothing new to prove here, but worth asserting so a future
change to that filter doesn't silently break this feature too).

The live send itself is not scenario-tested, matching how the client-pack delivery's own Graph
call is not driven by the harness — `sendAsMailbox`'s contract is exercised by the intake/pack
delivery scenarios already in the suite.

## What would send this back

- If `newAudit` turns out not to reliably carry one row per changed field in every batch shape
  (e.g. a multi-action batch where `updateIssue` is not the last action, or a rule-engine
  follow-up mutates status again within the same call) — found while reading `applyWithRules`'s
  `result.steps` more closely in the plan's grounding pass, before this is assumed.
- If `PersistResult`'s config-reading approach (reload vs. widen) turns out to need a shape more
  invasive than "one more field" — that would mean this is not as contained as designed here.
