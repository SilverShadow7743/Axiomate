# The revised operating model, reconciled against what is built

*18 August 2026. A reading of the Supply → Demand → Baseline → Work → Execute → Measure →
Control → Improve model against the code as it stands, not as it is remembered.*

The model is coherent and the sequence is right. This document does not restate it. It does three
things the model cannot do for itself: says where it **contradicts** what is already built, says
which parts are **already working**, and names the one constraint sitting under half of it.

---

## 1. Three contradictions worth deciding before anything is built

These are not gaps. They are places where the model and the code make different choices, so
adopting the model means retiring something that works.

### 1a. The baseline is already somewhere else

The model puts a `PROJECT BASELINE` — scope, schedule, cost, resources, quality, risks — at the
architectural control point, with explicit rebaselining.

Today the control point is the **statement of work**. `Sow.effortHours` and `Sow.value` are the
baseline, `ChangeRequest` is a signed delta against them, and `contractedPosition` computes
baseline-plus-approved on read. The SOW figures are never edited by a change; that is deliberate,
and it is the mechanism that answers *"what did we originally agree"* after four variations.

The model's baseline is **not an addition to that**. It is a different control point — one tier
lower (project rather than SOW) and much wider (schedule, resources, risks, none of which a SOW
carries). Adopting it means choosing one of:

| Option | What it means |
|---|---|
| **Baseline subordinate to the SOW** | The SOW stays the commercial commitment; a project baseline is a planning artefact beneath it. `contractedPosition` is unaffected |
| **Baseline replaces the SOW as the reference** | `contractedPosition` becomes redundant or subordinate, and `ChangeRequest` starts producing baseline *versions* rather than deltas |
| **Two baselines, reconciled** | Commercial (SOW) and delivery (project), explicitly related. The most honest and the most work |

Nothing should be built for §5 until this is answered, because the three produce different
schemas.

### 1b. Three named tiers are missing in the middle, and the middle is the expensive place

The model's hierarchy:

    Project → Workstream → Deliverable → Work Package → Process Area → Process → Scenario / Task

The built hierarchy:

    company ▸ client ▸ engagement ▸ project ▸ module     (structural tiers)
                                              └── issue → sub-issue → activity → milestone

`module` is already labelled **Process Area** in the shipped terminology, so the two agree at that
level and diverge above and below it. **Workstream**, **Deliverable** and **Work Package** have no
home — and they sit *between* two tiers that already exist, which is the costly place to insert.

Adding a structural tier is not one edit. It touches `NODE_KINDS`, `ALLOWED_PARENTS`, `canParent`,
the tree builder, `CREATABLE_KINDS` in `lib/actionShape.ts`, the row menu's `childKinds`, the
scope-override chain, and the intake endpoint's parent check — the last of which already caused
every client email to be refused with a 409 nobody saw, once.

### 1c. Assignment with effort does not exist

The model draws two levels of allocation, and is right to:

| Concept | Question | Built? |
|---|---|---|
| Capacity | How much can this person work? | **Yes** — `lib/capacity.ts`, effective-dated |
| Availability | How much remains? | **Yes** |
| Allocation | How much is reserved for a project? | **Yes** — `Allocation`: person → project → % → dates |
| **Assignment** | **What work are they responsible for, for how many hours?** | **No** |

`setAssignment` exists and is a different thing: it sets *responsibilities* on an issue — owner,
accountable, and whatever else the firm configures — and carries no effort at all. The model's
Level 2 ("estimated 32 hours") is a new relation, and it is the piece that makes the traceability
chain in §9 resolve. Today that chain breaks between allocation and time entry.

---

## 2. Two sections describe code that already runs

Worth saying plainly, because the model reads as though it starts from zero and it does not.

**§10 — `WORK PROGRESS ≠ DELIVERY ACCEPTANCE`.** Implemented, at milestone level. `Milestone`
carries delivery and acceptance as two independent axes with their own dates and actors, precisely
because "delivered but not accepted" is a pair of states rather than a stage. The reducer refuses
to let whoever recorded the delivery accept it. The model states the principle; the code already
enforces it. Extending it to deliverables is real work, but the argument is settled.

**§12 — a change must not move the baseline.** Implemented. `ChangeRequest` is a signed delta,
`Sow.effortHours` is never touched by one, and an accepted milestone freezes its own value so a
later approved change cannot retroactively move what a client signed for. The model's *"the
baseline should not change simply because someone edits a task"* is the rule those entities were
built around.

Partially built, and worth knowing precisely:

| Section | Exists | Absent |
|---|---|---|
| §2 People & Capability | Skills, proficiency, capacity, availability, cost, working pattern | Certifications, experience, manager, employment type, career level |
| §3 Account & Commercial | Engagement, SOW, Change Request, contacts-as-people | Account, Opportunity, Proposal, Contract as records |
| §9 Timesheets & Actuals | Time entries, timesheets, submission, approval, freeze | The variance link back to a plan |
| §1 Organization | Nothing beyond the tenant and the hierarchy | Legal entity, business unit, practice, department, team, location, calendars |

---

## 3. The constraint under half of the model

**People are keyed two different ways, and the model assumes one.**

    Allocation.person      display name       "M Tarun Kumar"
    TimeEntry.person       display name
    Commitment.person      display name
    PersonRate.personId    directory id       PERSON_63
    PersonSkill.personId   directory id
    Version.subjectId      directory id

§7 (allocation → assignment), §9 (actual hours traced back to the baseline) and §10 (progress
rollup) all assume one resolvable person from end to end. Today a rename breaks half the joins
silently, and a name that does not resolve produces a missing answer rather than an error — the
failure mode that gets discovered late. It has already happened once, to the identity fix that
created a second person record rather than correcting the first.

This is scoped in `docs/pending-actions.md` as the structural gap behind that incident, and it
needs its own design, because it turns on a distinction to be drawn carefully: fields that
identify **who somebody is** (a join key, which must move on a rename) versus fields recording
**what was written at the time** (an audit `by`, which must never be rewritten).

**It is the prerequisite for §7, §9 and §10.** Building any of those on the name join means
building them twice.

---

## 4. One question the model does not settle

§6's hierarchy includes **Process**, **Scenario** and **Configuration Deliverable**. That is the
Microsoft D365 Business Process Catalogue vocabulary — the same taxonomy as
`industry-process-scope-explorer.html`, where `Scenario` is a work-item type carrying an
`Acceptance Criteria` field.

Two different things could be meant, and they are different records:

1. **`SowScopeItem`** — structured scope entered against or extracted from a statement of work:
   deliverables, assumptions, exclusions, acceptance criteria. The audit names this and sequences
   it after file storage, which now exists.
2. **A work-breakdown tier** — Process and Scenario as levels *in the tree*, beneath Process Area,
   that work items hang from.

They can coexist. They are not the same record, and one should not silently become the other.

---

## 5. What this does not change today

The current sequence is operational delivery, chosen on 17 August for a stated reason: six
entities were built in two days, none had been exercised by a person, and the workspace held no
statement of work, no rate and no milestone. That reason still holds — the click-through has not
been run.

So this document records the model and does not schedule it. The next operational step is
unchanged: **C2, the calendar grid and My timesheet**, which read `TimeEntry` and write through
arms that already exist.

When the model's first increment is scheduled, the honest order is:

1. **The identity key** (§3 above) — because §7, §9 and §10 are built twice without it.
2. **The baseline decision** (§1a) — a schema fork, not a feature.
3. **Workstream / Deliverable / Work Package** (§1b) — the tiers, once there is something to hang
   beneath them.

Assignment-with-effort (§1c) is the smallest genuinely new thing and the one that makes the
traceability chain resolve — and it inherits the identity key.
