# N — SOW classification as a controlled decision: design

Validation finding N: "A client asks for something outside the SOW … stops at the judgement —
nothing reads the scope statement and decides whether a particular request is inside it."
Coverage Roadmap Tier 6: needed a spec from the user. Reproduced in full below the analysis.

**This document proposes an architecture and names the open decisions. It does not implement
anything** — new field, new required-reason gate, and a workflow-ordering question that touches
`ChangeRequest` creation, all real enough to deserve review before code.

## 1. The user's process, and what already exists to build it on

User's flow: **Client Request → Initial Triage → SOW Assessment → Delivery/Commercial Decision →
Approved Work.** SOW Assessment owned by the Delivery Lead/Engagement Manager, Commercial/Account
owner involved where commercial entitlement is affected. Classification recorded as one of **In
SOW / Out of SOW / Partially in SOW / Requires clarification**, with a required basis (SOW clause,
approved deliverable, existing work item, change request).

Checked against the code rather than assumed: `ChangeRequest` (`lib/commercial/changeRequest.ts`) already
carries `sowId` (every change request is already tied to a specific statement of work — the
object N's classification would be assessed against already exists as a real reference, not
something to add) and its own `status: ChangeStatus`, whose values are `['Draft', 'Submitted',
'Approved', 'Rejected', 'Withdrawn']`. **This is a different axis from what N needs.** `ChangeStatus`
tracks where a change is in its *approval* workflow; the user's SOW Assessment is a judgement
about *scope*, logically prior to (or alongside) that approval. Conflating the two — e.g. reusing
`Approved`/`Rejected` to also mean in-scope/out-of-scope — would make "approved but out of scope"
and "rejected but in scope" both unrepresentable, and both are real states a firm needs (a
descoping change is approved *because* it's out of scope and needs pricing, for instance).

Two mechanisms already do close to what the user asked for, on the adjacent `ChangeStatus` axis,
and the design below deliberately mirrors them rather than inventing new patterns:

- **`decideChangeProblem`** already enforces separation of duties (the person who raised a change
  cannot decide it) and **requires a note on rejection** — "Refusing a change needs a reason — the
  person has to know what to change or whether to stop." This is exactly the "must provide a
  basis" requirement the user described, already precedented, just not yet extended to SOW
  classification specifically.
- **`lib/planning/statusPolicy.ts`'s `checkTransition`** has a general `requireReason: IssueStatus[]`
  gate — but it operates on `IssueStatus`, a different enum from `ChangeStatus` or a prospective
  SOW classification. The *pattern* (some values in an enum require a reason before landing on
  them) is reusable; the mechanism itself is not directly, since it's typed to the wrong enum.

## 2. Proposed shape

- **New field on `ChangeRequest`: `sowClassification: 'InScope' | 'OutOfScope' | 'Partial' |
  'RequiresClarification' | null`** — null until assessed, matching this codebase's own
  convention of a real null state over a default guess (the same discipline `PersonRate`,
  `Timesheet.workingPatternStamp` and others already follow).
- **A required basis, mirroring `decideChangeProblem`'s existing reason requirement**:
  `sowClassificationBasis: string` — required (refused if blank) whenever `sowClassification` is
  set to anything but `null`, the same shape as "refusing a change needs a reason," extended to
  every classification value, not just rejection. The user's own examples (SOW clause, approved
  deliverable, existing work item, change request reference) suggest this is free text with a
  reference, not a structured link to one specific record type — a change can cite any of several
  kinds of evidence, and forcing one shape would refuse legitimate bases the way a single dropdown
  always does.
- **Who may set it**: the Delivery Lead / Engagement Manager role, by the user's own answer.
  Whether "Commercial/Account owner involved where the determination affects commercial
  entitlement" means a second required sign-off (a new approval-rule row, reusing
  `blockingRule`/`approvalRules` — already a real, general mechanism this session read while
  investigating `updateIssue`) or a notification/visibility requirement is the first open decision
  below — the two are meaningfully different amounts of new gating.
- **Ordering relative to `ChangeStatus`**: the user's flow puts SOW Assessment *before* the
  Delivery/Commercial Decision. Proposed: `sowClassification` can be set at any point before a
  change reaches `Submitted` — mirroring how `decideChangeProblem` already refuses a decision on
  anything not `Submitted` — so assessment naturally precedes the approval step it feeds, without
  a new state machine bolted onto `ChangeStatus` itself. `RequiresClarification` would sensibly
  block submission (a change can't sensibly be Submitted for approval while still unclear whether
  it's in scope) — whether it *hard*-blocks (a reducer refusal, matching this codebase's general
  preference for refusing over silently allowing) or just warns is the second open decision.

## 3. What this does not touch

`N` is about `ChangeRequest`, not the originating `Issue`. An issue of type "Change Request" can
exist, unassessed, before a formal `ChangeRequest` record is raised against it (per
`ChangeRequest.issueId`'s own nullable, deliberately loose design) — this proposal doesn't reach
back to gate issue creation itself, only the change-request record's own path to approval. Whether
an unassessed issue-typed-as-Change-Request sitting unconverted for a long time is itself worth
flagging is a separate, smaller question, not folded in here.

## Open decisions, for the user

1. Does Commercial/Account owner involvement mean a second required approval (a new
   `approvalRules` entry, gating `Submitted`→`Approved` the same way other blocking rules already
   do), or a lighter notification/visibility requirement?
2. Does `RequiresClarification` hard-refuse submission, or only warn? (This codebase's general
   pattern — refuse rather than warn, per `checkTransition`'s own design — argues for refuse, but
   the user hasn't stated a preference and it's worth confirming rather than assuming the
   codebase's default is automatically wanted here.)
3. Priority relative to CF3 and the still-unwritten runbooks/browser-test work — comparable in
   size to CF3, larger than anything shipped this session.

## Testing, once a direction is chosen

A new scenario proving: `sowClassification` refuses to be set without a basis (mirroring how
`decideChangeProblem`'s existing rejection-reason check is already proven); a change cannot reach
`Submitted` while `RequiresClarification` (if decision 2 lands on hard-refuse); and the field
survives exactly where `ChangeRequest`'s other fields already do (its own existing persistence/
mapper coverage, extended, not duplicated).
