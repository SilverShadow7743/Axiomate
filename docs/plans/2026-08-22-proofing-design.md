# Proofing — design

Phase 6 of the Hive gap program. Awaiting approval.

## What is being built, and what Hive's version becomes here

Hive's proofing is creative-agency tooling: pin a comment to a corner of an image, approve the
asset, compare versions. Axiomate's buyers ship **documents** — cutover plans, specs, month-end
packs — so the honest translation is **deliverable review**: a stored document on a record can
be sent to named colleagues for review; each answers *approve* or *request changes*, with a
note; a re-upload becomes a new version that visibly does NOT carry the old approval. Pixel
annotation on file contents is explicitly out of scope — a delivery firm reviews Word and PDF,
and marking up rendered previews is a different product.

## The checksum finally does its second job

`DocumentRecord.checksum` was built with two stated jobs, and only one has ever run. A review
**pins the checksum at the moment it is asked**. A new upload of the deliverable (see
versions, below) changes the checksum, so the question "is this still the document that was
approved" is answered by comparison, not by memory: the screen shows *approved — an earlier
version* the moment the bytes differ. Nothing is voided or rewritten; the review remains true
about the bytes it reviewed.

## Versions are a chain of uploads

`DocumentRecord` gains `supersedesId: string | null`. The Evidence panel's upload gains
"Upload new version" on an existing document row, which stores the new file normally and sets
the link. The chain is the version history — v1, v2, v3 are positions in it, displayed, never
stored as numbers. Old versions stay downloadable; the newest is what the row leads with. No
diffing, no preview rendering.

## A review is its own record, not a bent approval

`Approval` was considered and rejected: it is rule-created, gates a status transition, and
carries one decision. A review is asked ad hoc, addresses several people, and wants one
verdict *per reviewer*. So:

```ts
interface DocumentReview {
  id: string                    // rev-12, from the workspace counter
  documentId: string
  checksum: string              // pinned at request — the bytes under review
  issueId: string               // where it surfaces and is audited
  question: string              // what the asker wants judged, shown to every reviewer
  askedBy: string
  askedAt: string
  reviewers: string[]           // directory names; guests join in phase 7
  verdicts: {
    by: string
    verdict: 'approved' | 'changes'
    note: string                // "request changes" with no note is refused — a change
    at: string                  //  request that names no change is noise
  }[]
  withdrawnAt: string | null
  deletedAt: string | null
}
```

**The asker cannot verdict their own review** — `lib/approval.ts`'s rule, applied to a second
record type in its own words. A reviewer not on the list is refused. A second verdict by the
same reviewer *replaces* their first (changing your mind is normal), audited both times.

The review is **done** when every reviewer has answered; **approved** only when every answer
is approve. Partial states are shown as what they are ("2 of 3, one change requested"), never
collapsed into a traffic light.

## Permission and capability

`document.review` joins the permission table ("Review deliverables — answer approve or
request changes on a document sent to you"). Asking rides on the existing `document.upload`
(whoever may put a deliverable on the record may ask about it); answering needs the new key.
21st capability, `proofing`, needs `['document.upload', 'document.review']`. Stated
consequence, same as mail.send: stored roles will not hold the new key until granted —
Capabilities shows `lostInMerge` naming it, the Permissions screen is where it is granted, and
the capability-count assertion in CP1 moves 20 → 21 in the same commit.

Machines do not review. The MACHINE role does not receive the key, and the endpoint arms are
session-paths only — an agent proposing "this looks ready" is agent work; judging a
deliverable is not.

## Where it lives on screen

The Links tab's Evidence section (documents already render there). Each document row grows:
its version position, a review chip (*unreviewed · awaiting 2 · changes requested ·
approved · approved — an earlier version*), "Ask for review…" (reviewer picker from the
directory, a question box), and — for a named reviewer — Approve / Request changes with the
note field. A pinned note is written to the record when a review completes, so Notes stays
the story of the engagement.

## Storage

New Prisma model `DocumentReview` (verdicts as JSON on the row — read whole, written whole,
like observations elsewhere), a `supersedesId` column on `Issue`-side `Document`. Additive
migration. The full persistence chain: mapper pair, persist arm, loadWorkspace read,
`WorkspaceState.documentReviews`, scrub() entry — the persistence proof grows by the round
trip and a verdict-replacement case.

## Actions

`requestDocumentReview { documentId, reviewers, question, now }`,
`decideDocumentReview { reviewId, verdict, note, now }`,
`withdrawDocumentReview { reviewId, now }` — registered in the endpoint KINDS, actionShape
SHAPES, and ACTION_PERMISSIONS (`document.upload` / `document.review` / asker-or-upload
respectively). Upload's "new version" is the existing document POST with a `supersedesId`
field, validated server-side (same subject, not itself superseded).

## Error handling

Reviewing a checksum that is no longer the newest version: allowed, stated on screen — the
verdict is about bytes, and late answers about old bytes are still records. Asking with zero
reviewers, or only yourself: refused in words. A reviewer removed from the directory keeps
their recorded verdicts (facts), and the review completes against the reviewers it named.

## Testing

Pure first: review lifecycle in the reducer (ask, verdict, replace-verdict, refuse
self-verdict, refuse outsider, completion states, checksum pinning) — scenario PR1. Then the
count assertion 21, the persistence round trip, and the screens. The browser half becomes
checklist section 21: upload a deliverable, ask two people, answer as each (one from a second
account), re-upload, watch the chip say *approved — an earlier version*.

## What would send this back

- Verdicts-as-JSON proves wrong for the queries the screens need (surfaces at the plan's
  storage step) — a verdict table, and the design's "read whole, written whole" claim was
  wrong.
- The Links tab cannot hold the review UI without crowding (surfaces at the screen step) — a
  drawer like Evidence's manage panel, not a squeeze.
- Reviewers-by-name proves unworkable before the identity-id migration lands (surfaces in
  testing with two accounts) — then the migration stops being "before phase 7" and becomes
  "before phase 6 ships".
