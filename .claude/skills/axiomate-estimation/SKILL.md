---
name: axiomate-estimation
description: This skill should be used when estimating the size, complexity, or effort of an issue in Axiomate TMS, or when building/modifying any estimation UI or logic. It supplies the real Axiomate Estimation Model (five 0-5 dimensions, T-shirt bands from Configuration) so a new estimate is never a naked number without its assumptions. Load alongside axiomate-work-model.
---

# Axiomate Estimation

The estimation model already exists in the schema, named verbatim as "the Axiomate Estimation
Model" — this is not a new methodology to invent, it's a real, structured field set to use
correctly.

## The real model

`IssueEstimate` (`prisma/schema.prisma:1038`) — five dimensions, each `Int? 0–5`:

```
business · technical · integration · testing · data
```

Plus: `sizeOverride: String?` (an explicit T-shirt size; when null, the size is DERIVED from
the five-dimension score — never hardcode a size independent of the score unless the override
field is being deliberately set, with a reason), `approvedEffortHours: Int?`, `confidence:
String` (default `"Medium"`), `steps: Json` (an effort breakdown, each step carrying
`dependsOn`), `baselinedAt`/`baselinedBy`, and an `EstimateRevision` table holding change
history — an estimate's history is retained, never overwritten silently.

**The band calibration (XS/S/M/L/XL/XXL/3XL and their score ranges) lives in `OperatingModel`'s
config JSON — Configuration's "T-shirt sizing" section — NOT in this schema.** The schema
stores the raw per-dimension score; the tenant's configuration maps score to band. A tenant can
recalibrate bands without a schema change — never hardcode a score-to-band mapping in code.

## An estimate must never be naked

Every estimate this skill produces or reviews states:

1. **The five scores**, not just a resulting size — the size is derivable from them and a
   reviewer should be able to check the derivation, not just trust a label.
2. **Assumptions** — what's presumed true that, if wrong, changes the estimate materially.
3. **Dependencies** — from `steps`' `dependsOn`, not a prose afterthought.
4. **Risks** — what could push effort beyond `approvedEffortHours`.
5. **Confidence** — Low/Medium/High, honestly, not defaulted without consideration.

## Baselining

An estimate is proposed (scored, no `baselinedAt`) before it's baselined (committed, with
`baselinedAt`/`baselinedBy` set). Changing a baselined estimate goes through `EstimateRevision`,
not a silent field update — the estimate's history is itself decision-relevant data (was the
scope wrong, or was the original estimate wrong).
