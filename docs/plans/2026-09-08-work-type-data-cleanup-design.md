# 134 issues carry a raw work-type code instead of its label — and a duplicate registry to match

**Status: draft, 8 September 2026.** Surfaced during I20's re-verification of the Add Work
dialog, after the original UX-audit fix for raw `WT_*` codes leaking into the UI (I20) turned out
to have fixed the *display* without the underlying data actually matching. Not built. **No
production data has been touched** — the near-miss below is exactly why.

## What's actually happening, traced precisely

`Configuration → Work types` lists 20 entries, not the 11 that show up as clean options. Nine are
a duplicate set with double-prefixed ids and their own raw code as the label:

| Clean entry | Duplicate entry |
|---|---|
| `id: WT_EPIC, label: "Epic"` | `id: WT_WT_EPIC, label: "WT_EPIC"` |
| `id: WT_CHANGE_REQUEST, label: "Change Request"` | `id: WT_WT_CHANGE_REQUEST, label: "WT_CHANGE_REQUEST"` |
| …and 7 more pairs (Decision, Defect, Deliverable, Issue, Request, Risk, Task) | |

`ConfigWorkspace.tsx`'s own "records" count (`counts[i.type]` keyed by each issue's literal
`type` string, looked up via `counts[t.label]` per row) proves which side of each pair real data
actually sits on: **the duplicate entries carry 134 combined records; the clean entries carry
zero.** Every one of these 134 issues has `type` stored as the raw code (`"WT_EPIC"`) — never the
human label (`"Epic"`) that `create`/`draftFor` write for issues made through the app today.

**Mechanism**: `lib/config.ts`'s type-discovery loop (`for (const label of sourceTypes) { const
id = workTypeId(clean); workTypes[id] = {...} }`) runs once over whatever the imported log's own
type column said. For most records that was a human label ("Epic"), producing the clean entries.
For 134 records, the source data already held the raw code itself (`"WT_EPIC"`) — the loop had no
way to know that and treated it as a fresh label, minting `workTypeId("WT_EPIC")` →
`"WT_WT_EPIC"`, a genuinely new, non-colliding id. Nothing is broken about the discovery logic
itself; it faithfully reflects what the source data said, twice, because the source data said the
same category two different ways.

## The near-miss, disclosed

I initially misread a truncated output as "0 records" for all nine duplicate entries and proposed
archiving them as a safe, zero-risk cleanup — Nishant approved that. Re-checking the actual counts
before acting (the archive button is `disabled={used > 0}` in the UI, which would have refused the
click anyway — a real guardrail that worked) found the true numbers and the approval was not
acted on. Named here so the record is honest, matching this session's standing practice of
correcting rather than quietly dropping a wrong claim.

## What already doesn't need fixing

The I20 display fix (`workTypeLabelById.get(issue.type) ?? issue.type`, in `FilterBar.tsx` and
`OverviewTab.tsx`) already resolves these 134 issues to "Epic" etc. correctly today, by id, and
needs no change — it degrades gracefully either way this design resolves. Filtering by Work Type
also already works correctly regardless of which string is stored, since `facetsOf` filters on
whatever is actually present.

## The real question: rewrite history, or leave it and keep displaying around it

**Option A — migrate the data.** A one-time script, run once, dispatching `updateIssue` through
the normal reducer path (not a raw SQL update) for each of the 134 affected issues, rewriting
`type` from the raw code to the matching clean label. Attribution and the audit trail record this
as 134 ordinary edits, by whichever actor runs the migration. After this, the nine duplicate
registry entries show 0 records and their Archive buttons unlock — deleting them is then a
one-click cleanup with the UI's own safety already proving it's safe.

**Option B — leave the data as imported, keep resolving it at read time.** The display fix already
works; a raw code sitting in `type` is arguably an honest historical record of exactly what the
source log said, consistent with `WorkType`'s own doctrine ("discovered, not invented: whatever
the imported records actually say they are"). Under this option the duplicate registry entries
stay, permanently correct and permanently unarchivable, and the Add Work dialog's dropdown needs
its own separate, smaller fix: dedupe by filtering out any `WorkType` whose `label` matches the
`WT_[A-Z_]+` shape (a raw-code-looking label is the tell, not a text collision) before rendering
options, so nobody is offered the confusing duplicate going forward even if the historical ones
stay unmigrated.

Both keep the Add Work dropdown clean; they differ only in whether the 134 historical records
themselves get corrected. This is a data-history judgment call, not a technical one — named as the
open question below rather than decided here.

## What would send this back

If Option A is chosen and the migration script, run once against a copy of production data,
surfaces any issue whose `type` is read by something other than `liveWorkTypes`/`facetsOf`
resolution (a report, an export, an integration) in a way that assumes the raw-code shape
specifically, that dependency needs to be found and accounted for before the real run — surfaces
at the dry-run step, not decided here.

## Open question for Nishant

Option A (migrate the 134 records to clean labels, then archive the 9 duplicate entries) or
Option B (leave history as imported, add a small dedupe filter to the Add Work dropdown instead)?
