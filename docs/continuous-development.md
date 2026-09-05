# How Axiomate gets developed

*17 August 2026. What the loop already is, what enforces it, and the five places it is not yet
closed.*

Most of this framework already exists in the repository. It has never been written down, which
means it survives by habit rather than by design — and a discipline nobody can read is one that
degrades quietly as soon as somebody new joins. This document is the readable version, and it is
deliberately honest about the parts that are aspiration rather than practice.

---

## The loop

    idea ──→ design ──→ plan ──→ build ──→ proof ──→ gate ──→ deploy
              │          │                   │        │
              └─ docs/plans/*-design.md      │        └─ .github/workflows/deploy.yml
                         └─ *-plan.md        └─ scripts/*-proof.ts + scenario suite

Six steps, and the only one with no artifact is the first.

### 1. Idea → design

An idea becomes `docs/plans/YYYY-MM-DD-<topic>-design.md`. The design argues for an approach and
records what was rejected and why. There are four of them today: timesheets, effective dating,
financial dimensions, work management.

**The rejections are the valuable half.** The effective-dating design records that bitemporality
was considered and refused; two days later, when the same shape came up for timesheets, that
record was what made it obvious the refusal had been scoped to versions rather than universal.
A design that only says what was built cannot do that.

### 2. Design → plan

An approved design becomes `docs/plans/YYYY-MM-DD-<topic>-plan.md`, ordered by one rule:

> **Each step must be provable before anything depends on it.**

Pure logic first — no clock, no I/O, so it can be driven directly the moment it exists. Then
callers, then storage, then anything needing a browser or a deploy. Every step names its
verification **command**, not "run the tests". Every plan names the step carrying the most
regression risk and says whose hands the breakage lands in.

Plans also state their commit boundaries. Work meaningless in halves lands together; anything
carrying a migration stands alone, because a migration landing beside unrelated changes cannot
be reverted independently.

### 3. Build

The house rules, which the gates enforce rather than merely recommend:

| Rule | Enforced by |
|---|---|
| The reducer is pure — `apply(state, action, actor)`, no clock, no I/O | `audit:attribution` |
| Attribution is a **parameter**, never a field of the action | `audit:attribution` |
| Every tenant-scoped query names its tenant | `audit:tenancy` |
| A new action kind is registered at the boundary or it does not compile | `SHAPES … satisfies Record<Exclude<Action['t'],'notify'>, Shape>` |
| Derived values are never stored as fact | nothing automated — see gap 3 |

That last row is the one this codebase is actually built on, and it is the one with no gate.

### 4. Proof

Five proofs, each answering a question no other one can:

| Command | Question |
|---|---|
| `npm run audit:tenancy` | Can one firm's query reach another firm's rows? |
| `npm run audit:attribution` | Can a change be made that nobody is answerable for? |
| `npm run audit:restore` | Does archiving and restoring put things back where they were? |
| `npm run audit:estimation` | Do the estimate figures recompute from their inputs? |
| `npm run audit:persistence` | Does what the reducer decided come back out of Postgres? |

`audit:persistence` is the one that earns its keep most often. It is the only check that reads
back what it wrote, and it is what caught the audit mapper learning `byId` on the writer and not
on the reader — every row went into Postgres carrying an identity and came back without one,
which is invisible from either side alone.

### 5. The scenario suite

`npm run validate:scenarios` — 54 scenarios, and it is **a map of what the product does not do**,
not a pass/fail test run. Verdicts are `PASS`, `PARTIAL`, `NOT IMPLEMENTED`, `NOT TESTABLE`, and
most are not `PASS`. That is the point: it is the honest inventory.

Because of that, the CI gate is not "everything must pass". It is:

> **A scenario that passed on the last commit and no longer passes fails the run.**

A gate on the totals would block every honest release and be switched off within a week. A gate
on nothing would let working behaviour break silently. Losing ground is the line, and the harness
runs against a fixed `TODAY` constant so the comparison is deterministic rather than a function
of the day the pipeline ran.

### 6. Gate and deploy

`.github/workflows/deploy.yml`, on push to `master`/`main`. One deploy at a time, never
cancelled — a cancelled run can stop between `migrate deploy` and the slot swap, leaving a
migrated database in front of the previous release's code, which is the one state the pipeline
exists to avoid.

Order: typecheck → four database-free audits → migrate a throwaway Postgres → persistence audit →
scenario suite → regression gate → build → package → staging slot → swap.

---

## The five places the loop is not closed

Stated plainly, with what each would cost.

### Gap 1 — there is no structural template at any level

Checked today. `ProjectTemplate` exists and three are seeded, but it configures **automation** —
which agents run, which workflows, whether they need approval. Adopted per scope by
`adoptTemplate`.

| Level | Template? | What it carries |
|---|---|---|
| Engagement | yes | agents, workflows, approval requirement — **no structure** |
| Issue | no | `workTypes` names 7 kinds; `workflows` sequences agents on inbound mail. Nothing pre-fills an issue or seeds a checklist. |
| Action / activity | **none** | activities are created one at a time, by hand, every time |

So a new engagement starts empty and somebody rebuilds the same skeleton by memory. That is how
two engagements end up with different definitions of the same phase, and it is why the register
grew 48 duplicate points before anybody noticed.

What it needs: a `StructureTemplate` — an engagement shape, the issues a phase always carries,
the activities an issue type always breaks into. Distinct from `ProjectTemplate`, which should
keep its name and its job. This is the largest single gap and the one with the clearest payback.

### Gap 2 — nothing checks the rule the codebase is built on

"Derived values are never stored as fact" has no gate. It is enforced by review and by comments,
and it has already been broken twice this month — the seeder stamping `source: 'stated'` on a
profile nobody stated, and a `?? JsonNull` fallback that would have written "the value was null"
and called it a record. Both were caught by a person reading, which does not scale.

A partial gate is achievable: a script that flags any Prisma model field whose name matches a
known derived quantity (`duration`, `health`, `total`, `remaining`, `utilisation`) and requires
an explicit allow-list entry with a reason. It would not catch everything. It would have caught
both of this month's.

### Gap 3 — the gates only run in CI

Every check above runs on push. Nothing runs before commit, so the loop is: commit, push, wait
several minutes, discover the typecheck failed. A pre-commit hook running `tsc --noEmit` and
`audit:tenancy` — the two fastest and most frequently broken — would cost seconds and close it.

### Gap 4 — scenarios and designs are not linked

A scenario says what it tests. It does not say which design introduced it, and a design does not
list the scenarios that prove it. So "is this design actually built?" is answered by reading, and
a design can sit at PARTIAL indefinitely without anything noticing.

A `design:` field on each scenario and a coverage line in each design would make
"which designs are unproven" a query rather than an afternoon.

### Gap 5 — no cadence for the backlog the suite already measures

The suite reports 11 P1 gaps and 23 PARTIAL verdicts. Nothing schedules work against them, so
they persist across releases while new capability lands on top. The measurement exists; the
cadence does not.

Proposed: one P1 per delivery cycle, chosen before new work is planned rather than after. Not a
policy anyone will follow if it is a paragraph in a document — it belongs in the plan for each
cycle, as step zero.

---

## Cadence

| When | What |
|---|---|
| Per change | design if the approach is open; plan if it is settled; then build |
| Per commit | typecheck, and the audits touching what changed |
| Per push | the full pipeline, and the regression gate decides |
| Per cycle | one P1 from the suite, chosen first |
| Per quarter | reread the rejections in `docs/plans/` — some of them stop being right |

## The handoff record

Since 5 September 2026 each step of the loop has an artifact: a Requirement Specification for
the idea, an Architecture Decision when the design is open, an Implementation Plan, a Change
Set, a Validation Result, a Release Decision, and an Incident Report when production disagrees.
They are JSON files in `docs/artifacts/`, checked by `npm run audit:contracts` in the standing
gate, and the agents that produce them and the gates a person holds are in
`docs/plans/2026-09-05-agentic-operating-model-design.md`. The loop above is unchanged; the
artifacts are what make each step readable by the next agent instead of by memory.

That last row matters more than it reads. Bitemporality was rejected for versions and is correct
for timesheets. A rejection is a decision made under the constraints of a particular week, and
the constraint that justified it can expire without anybody revisiting the conclusion.

---

## What this framework refuses

**Coverage percentages.** The scenario suite is a map, not a score. A number would be gamed the
week after it appeared.

**A green tick over a gate that did not run.** The persistence audit needs a database, and
guarding it with `if: env.DATABASE_URL != ''` would produce a passing pipeline over a check that
never executed — which is worse than not having it, because it reads as coverage. CI runs a
Postgres service container instead.

**Automated dependency bumps that merge themselves.** Prisma 7 removed `--to-schema-datamodel`
and Next 16 changed conventions this repository's own AGENTS.md warns about. Both would have
merged green and broken something a gate does not watch.
