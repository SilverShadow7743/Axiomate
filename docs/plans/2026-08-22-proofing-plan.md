# Proofing — implementation plan

Follows `docs/plans/2026-08-22-proofing-design.md` (approved 22 Aug 2026). Ordering
principle: the review lifecycle is pure logic and is proven by scenario before any storage or
screen exists; storage next (it carries the migration and stands alone); screens last; the
two-account browser proof is the only step no harness can run.

The design's governing constraints, quoted: *"the review pins the checksum at the moment it
is asked"*; *"the asker cannot verdict their own review"*; *"'request changes' with no note is
refused"*; *"machines do not review"*; *"nothing is voided or rewritten; the review remains
true about the bytes it reviewed"*.

## Steps

**1. `lib/proofing.ts` (new) — the pure half.**
`DocumentReview` type as designed; `reviewStateOf(review): { answered: number; total: number;
outcome: 'awaiting' | 'changes' | 'approved' }` (approved only when every reviewer approved);
`coversDocument(review, doc): boolean` (checksum equality — the "approved — an earlier
version" test); `versionChainOf(documents, docId): DocumentRecord[]` (walk `supersedesId`
back, newest first); `describeReview` for the chip. No clock, no I/O.
*Verify:* `npx tsc --noEmit`; driven by step 3's scenario.

**2. Reducer arms + registration — `lib/workspace.ts`, `lib/actionShape.ts`,
`lib/access.ts`, `app/api/workspace/route.ts`.**
`WorkspaceState.documentReviews: Record<string, DocumentReview>` (init `{}` in
`initWorkspace` beside `documents: {}` at workspace.ts:623). Arms:
`requestDocumentReview` (document exists and live; ≥1 reviewer; reviewers ≠ only the asker;
checksum pinned FROM THE STORED DOCUMENT, never from the action), `decideDocumentReview`
(reviewer must be named on the review; asker refused in approval.ts's words; `changes`
without a note refused; a second verdict by the same reviewer replaces the first; both
audited), `withdrawDocumentReview` (asker or `document.upload` holder). Completion of the
last verdict appends the pinned note to the record ("Review of <name> vN: approved by …"),
minted inside the same arm so replay parity holds. `recordDocument` accepts
`supersedesId` (validated: same subjectId, target not already superseded).
ACTION_PERMISSIONS: request → `document.upload`, decide → `document.review`, withdraw →
`document.upload`. All three in the route's KINDS (they arrive from the browser) and in
SHAPES. MACHINE role does NOT gain `document.review`.
*Verify:* `npx tsc --noEmit`; the scenario in step 3.

**3. Scenario PR1 + the count assertion — `scripts/scenario-validation.ts` (CRLF; python
script file).**
Ask two reviewers → awaiting 0/2; asker's own verdict refused; outsider refused; `changes`
with empty note refused; both answer → outcome from the verdict pair; one reviewer changes
their mind → replaced, not appended; re-upload with `supersedesId` → `coversDocument` false
against the new bytes while the review still reads true against the old; withdraw. CP1's
count assertion moves `healthy.length === 20` → `21` (scenario-validation.ts:4033) in the
SAME commit as the capability entry in step 4.
*Verify:* `npm run validate:scenarios` — PR1 PASS, FAIL count 0 **checked from parsed JSON**
(`data/validation.json .findings[].verdict`), not a string grep.

**4. Permission + capability — `lib/access.ts`, `lib/capabilities.ts`.**
`{ key: 'document.review', label: 'Review deliverables', … }` in PERMISSIONS; granted in
DEFAULT_GRANTS to the roles holding `approval.decide` today (judging a deliverable and
deciding a gate travel together); NOT the machine role. 21st capability `proofing`, `needs:
['document.upload', 'document.review']`.
*Verify:* `npm run validate:scenarios` (CP1 at 21; the suite fails if either half ships
alone).

**5. Storage — `prisma/schema.prisma`, migration, `lib/db/map.ts`, `lib/db/persist.ts`,
`lib/db/repo.ts`, `scripts/persistence-proof.ts`.
THE STEP CARRYING THE MOST REGRESSION RISK** — it touches the persistence chain every
existing write flows through, and it carries the migration. New model `DocumentReview`
(verdicts as JSON, read whole / written whole) plus `supersedesId String?` on `Document`
(prisma/schema.prisma:1166). Additive migration
`prisma/migrations/20260822000001_document_review/` applied with `npx prisma migrate deploy`
BEFORE the code deploy, as the sla_pause migration was. Mapper pair in map.ts; persist arms
for the three actions (diff-based, like `persistNotificationDiff`); `loadWorkspace` reads the
table into `documentReviews`; `scrub()` in scripts/persistence-proof.ts:119 gains the table
or the proof fails its own completeness check (the error at line 169 names this exact
omission). If it is wrong, every tenant delete and every proof run breaks — in the
operator's hands, not a reviewer's.
*Verify:* `npm run audit:persistence` — the count grows past 44/44 with a review round trip
and a verdict replacement; `npm run audit:tenancy` (the new mapper must stamp tenantId, 25 →
26).

**6. Screens — `components/DetailPanel.tsx` (Links tab Evidence section),
`components/EvidencePanel.tsx`, `components/IssueWorkspace.tsx`.**
Document rows gain version position (from `versionChainOf`), the review chip
(`describeReview` / *approved — an earlier version* via `coversDocument`), "Ask for
review…" (directory picker + question, visible with `document.upload`), and
Approve / Request-changes with the note field, visible only to a named reviewer holding
`document.review` — both-halves rule, the arm refuses what the button hides. "Upload new
version" on a document row passes `supersedesId` through the existing `/api/documents` POST
(`app/api/documents/route.ts`) and upload path.
*Verify:* `npx tsc --noEmit && npm run build`; the browser half in step 7.

**7. Checklist section 22, sweep, deploy, two-account proof.**
Section 22 (21 is taken by the week-5 record if numbering collides — check the file): observe
`lostInMerge` naming `document.review`, grant it, upload a deliverable, ask two people,
verdict as the operator (refused on own ask), verdict as Tarun (the second account the
verification backlog already needs), re-upload, watch *approved — an earlier version*.
Sweep: suite + persistence + tenancy + attribution + build; `git archive` clean-room
release; `az webapp deploy`; health probe.

## Details most likely to be got wrong

- **Pin the checksum from the STORED document**, not from anything the action carries — an
  action-supplied checksum would let a caller ask about bytes that were never stored.
- **A replaced verdict replaces; it must not append** — completion counts reviewers, not
  verdicts, or changing your mind completes a review early.
- **The completion note is minted inside the arm**, so the server's replay mints the same
  note the browser's optimistic copy did (the assignment-notification precedent).
- **`supersedesId` validation reads the TARGET document's row** (same subjectId, not itself
  superseded) — validating from the client's claim would let chains cross records.
- **scrub() before the proof runs** — the proof's own error message at
  persistence-proof.ts:169 says what happens otherwise.
- **CP1's 20 → 21 rides in the same commit as the capability** (step 3+4 together), or CI
  fails on the count in one direction or the other.
- The FAIL gate is **parsed JSON**, never a grep — the pretty-printed file defeated a string
  grep once already (week 5's commit records it).

## Commits

Steps 1–2 together (the lifecycle is meaningless in halves). Steps 3–4 together (the
assertion and the catalogue move as one). Step 5 alone (it carries the migration). Step 6
alone. Step 7 with the checklist.

## What would send the design back

- Verdicts-as-JSON cannot answer the screens' queries (surfaces in step 6) — a verdict
  table, and the storage step reopens.
- The Links tab cannot hold the review UI without crowding (surfaces in step 6) — a drawer,
  per the design's own send-back list.
- Two accounts cannot exercise reviewer identity because names drift (surfaces in step 7) —
  the identity-id migration moves ahead of this phase shipping.
