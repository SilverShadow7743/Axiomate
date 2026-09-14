# Owner is exactly the firm's own people — design

Nishant, 14 Sep: "owner field will be exactly people from our organization." Confirmed via
AskUserQuestion: remove the Client group from the Owner picker everywhere, going forward.

## Where this sits today

`lib/ownerChoices.ts`'s `ownerChoicesFor` (built 12 Sep, I36) is the one function behind every
Owner picker: Add Work / Edit dialogs (`Dialogs.tsx`), the record page's field strip
(`DetailPanel.tsx`), Tree/Board inline quick-edit (`QuickEditPopover.tsx`,
`SelectionToolbar.tsx`), and the bulk-reassign toolbar (`IssueWorkspace.tsx`). It offers two
groups: `team` (every active non-client person) and `client` (active seats of the record's own
client node, via `clientNodeOf`). A stored value naming nobody offered is carried as `unlisted`
so the control still shows it without rewriting data.

`client` exists because the 12 Sep decision ("I25 Tier 3") deliberately let a client contact be
named alongside the firm's own people. That's the piece being reversed: an issue, and an
engagement/project node, should only ever be owned by someone in the organization.

## The change

**`ownerChoicesFor` never resolves a client group.** `OwnerChoices` drops the `client` field —
`{ team, unlisted }` only. `team` keeps filtering out client seats exactly as it does today (an
org-only picker still isn't "everyone in the directory" — client-seat people stay excluded, not
promoted to team). `ownerOptionValues` drops the `...client.map(...)` spread. `clientNodeOf` is
deleted from this file — nothing inside `ownerChoicesFor` needs a client node once there's no
client group to scope, and its only outside caller is the bulk-reassign logic below, which stops
needing it too. `CLIENT_ORG_ROLES` stays exported: `CapacityPanel.tsx` uses it for an unrelated
purpose (excluding client seats from capacity/allocation figures), untouched by this change.

**`anchorId` is dropped from `ownerChoicesFor`'s signature.** It existed only to resolve the
client node. Once that resolution is gone it's a parameter every call site would pass for no
effect — worse than removing it, because it invites a future reader to assume it still scopes
something. Call sites (`Dialogs.tsx:44`, `DetailPanel.tsx:1497`, `IssueWorkspace.tsx:1114`,
`QuickEditPopover.tsx`, `SelectionToolbar.tsx`, `scripts/scenario-validation.ts`) update to the
two-argument form. `tsc --noEmit` finds every one mechanically.

**`IssueWorkspace.tsx`'s `bulkOwnerOptions` (1070-1081) simplifies to a plain call** — no
`clientNodes`/`sharedAnchor` computation, since there's no client scoping left to agree or
disagree on:

```ts
const bulkOwnerOptions = useMemo(() => ownerOptionValues(ownerChoicesFor(state, null)), [state])
```

The `clientNodeOf` import is removed from this file. (`IssueWorkspace.tsx` separately imports an
unrelated same-named-differently function, `clientNodeId` from `lib/workspace.ts` — not touched.)

**The Client optgroup JSX is deleted, not left dead behind a false condition**, in the two
places it's hand-rolled: `DetailPanel.tsx:1635-1637` and `Dialogs.tsx:61-63` (both currently
`{choices.client.length > 0 && (...)}`). Leaving `ownerChoicesFor` always return an empty
`client` array and leaving this JSX in place would compile and render nothing, but it's a
landmine for the next reader wondering how a client would ever appear — deleting it says plainly
that the feature is gone, not dormant.

**Not touched:** `ProfilePanel.tsx`'s own `isClientSeat` (line 89) is a separate, local
re-declaration for a person-profile label, unrelated to the Owner picker. `lib/reports/
resolutionNotice.ts`'s own `clientNodeOf` (line 33) is a different, unrelated function local to
that file's client-facing resolution notice. Neither is part of `ownerChoices.ts`'s API and
neither changes.

## Data impact

Checked 14 Sep, per this session's own Owner-cleanup work: zero open or closed issues currently
carry a real client-seat person as Owner. This is a pure forward-looking behavior change with no
issue-level data to migrate. Node-level Owner (an engagement/project's own Owner, set via
`updateNode`) wasn't separately re-checked this pass — if any node happens to carry a client
seat's name today, `unlisted` keeps it visible and selectable exactly as it does for any other
value naming nobody currently offered; nothing breaks, it simply stops being reachable from the
dropdown going forward, same as any other value that falls out of the offered set.

## Test/doc surface that has to change with it

- `scripts/scenario-validation.ts:2427-2463` is a scenario that asserts the *current* client-
  group behavior (an `expected` string describing the two-group model, a second client node
  built solely to prove cross-client seats aren't offered, `.client.length`/`.client.map` reads
  that won't compile once the field is gone). This scenario is rewritten, not just patched to
  compile: it now asserts the directory is the only source, that a client-seat person is never
  offered regardless of anchor, and that a pre-existing non-directory value (the nine-issue dual
  owner from I25 Tier 3) still carries as `unlisted`. Its committed twin, `data/validation.json`
  (line 438's `expected` string), changes to match — this is the one place this session's usual
  "the diff must be empty or additive" verification gate does not apply; the diff is reviewed
  line by line to confirm it touches only this one scenario's row.
- `lib/ownerChoices.ts`'s own doc comment (lines 5-29) is rewritten: the two-group history stays
  (it's real, dated history), with a closing line recording the 14 Sep reversal and why.

## What would send this back

- If node-level Owner data turns out, on inspection, to actually carry a client-seat name
  somewhere — doesn't invalidate the design (the `unlisted` fallback already covers it), but
  means the "pure forward-looking, no migration" framing above needs a one-line correction before
  shipping.
- If some other caller of `clientNodeOf` or the `client` field turns up during implementation
  that this grep pass missed — would mean re-scoping before deleting, not patching around it.
