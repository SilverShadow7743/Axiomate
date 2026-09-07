# Person / User Account / Resource Profile / Resource Allocation — what exists against what was proposed

*7 September 2026. A comparison, not a design — requested against a four-layer model proposed
during this session (Person → User Account → Resource Profile → Resource Allocation, contrasted
with a flat Hive-style user profile). This maps that proposal onto six existing files rather than
assuming it is a gap, then names what is actually missing.*

## The short answer

Three of the four proposed layers already exist as separate records, correctly split. The fourth
— a distinct **User Account** layer — does not, and that is a real, specific gap: today,
permission roles are a field on the same record as name and manager, not a separate object. The
proposal's `Person → Capability → Availability → Allocation → Work → Time → Revenue → Margin`
chain is also real, but it is not wired as one traceable path today — each link exists, adjacent
links are not joined.

## Layer by layer

| Proposed | What exists | File | Verdict |
| --- | --- | --- | --- |
| **Person** (the human) | `Person` — id, name, email, manager, client scope | `lib/config.ts` | Exists, matches |
| **User Account** (auth, access, permissions) | *Not separate* — `Person.roleIds` sits on the same record as name/email/manager | `lib/config.ts` | **Missing as its own object** — see below |
| **Resource Profile** (capability, delivery shape) | Split across three records, not one: `ResourceProfile` (working pattern only — hours/day, days/week, billable target), `PersonSkill` (skill + level + source + last-used, per skill), `PersonRate` (cost/bill rate, dated) | `lib/capacity.ts`, `lib/skills.ts`, `lib/rates.ts` | Exists, differently shaped |
| **Resource Allocation** (the assignment) | Two records, not one, answering two different questions on purpose: `Allocation` (how much time, capacity math) and `ProjectMember` (may this person be here at all, access) | `lib/capacity.ts`, `lib/staffing.ts` | Exists, deliberately split — see below |

## Where the shapes genuinely differ, and why that might be right

**Resource Profile is three records, not one, and the split is load-bearing, not accidental.**
`ResourceProfile` itself carries a `source: 'stated' | 'default'` flag with real teeth —
`profileAt` (`lib/capacity.ts`) returns a working pattern for a date even when nobody has
recorded one, and every consumer of a capacity figure can tell whether it rests on a confirmed
number or an assumed one (`CapacityPosition.basis`). A merged "Resource Profile" object combining
working pattern, skills and rates into one record would either lose that provenance distinction
or have to carry three separate provenance flags on one object, which is the same information
architecture with extra ceremony. Skills and rates are also both independently *dated* — a rate
changes on a specific day, a skill's `lastUsed` moves independently of hours-per-week — so folding
them together would mean one record with three different effective-dating stories layered on it.

**Resource Allocation is two records for the same reason `Allocation` and `ProjectMember` state
directly in their own module comments: capacity and access are different questions.**
`ProjectMember` requires a resolved `personId` because it is an access-control fact that has to
match a signed-in session; `Allocation` tolerates an unresolved name because a capacity report is
still useful even when a name did not uniquely resolve. Merging them would force one of those two
correctness rules to bend for the other. `ProjectRole` — Sponsor, PM, Solution Architect,
Consultant, thirteen seeded values — is exactly the proposal's "Role" field on Resource
Allocation, already there, already relabel-able per firm.

So the proposal's shape and this codebase's shape agree on *what questions need answering*; they
disagree on *how many records answer them*, and the disagreement is mostly this codebase choosing
more, narrower records with an explicit reason each — the same instinct that split delivery and
acceptance into two axes on `Milestone` rather than one status lane.

## Where the gap is real

**No `UserAccount` object.** `Person.roleIds` — the permission grant — lives on the identity
record itself. Practically, this means "who someone is" and "what they may do" cannot change
independently at the data-model level: relabelling a person's directory entry and changing their
permission set are the same write to the same record, with no seam between them. This is a real
architectural gap against the proposal, not a difference of taste — Entra ID already handles
*authentication* as a genuinely separate layer (`AXIOMATE_ENTRA_*`, resolved to a `Person` by
email at sign-in), but *authorization* (`roleIds`) was never pulled out the same way.

**No single traceable chain.** The proposal's `Person → Capability → Availability → Allocation →
Work → Time → Revenue → Margin` is real fact-by-fact (`PersonSkill` is capability, `ResourceProfile`
+ `Commitment` is availability, `Allocation`/`ProjectMember` is the assignment, `TimeEntry` is
work and time, `PersonRate` × `TimeEntry` is revenue via `costOf`/`sowCostOf` — proven by scenario
`RT1`) but nothing reads it as one chain today. `CommercialPanel` shows cost against a SOW;
`CapacityPanel` shows allocation against a person; nothing walks person → skill → allocation →
hours → margin as a single reported line the way the proposal's own worked example does ("Rahul →
60% ABC, 20% XYZ, 20% Internal → total utilisation 100%").

## What this means for future work

Two real candidates, neither designed here:

1. **Extract `UserAccount`** (or, more modestly, move `roleIds` off `Person` onto its own
   per-tenant record keyed by `personId`) — a genuine gap, small in schema terms, real in
   consequence for anyone who wants to reason about access changes separately from directory
   changes.
2. **A person-centric utilisation rollup** — the chain already exists in pieces; joining
   `Allocation` + `ProjectMember.projectRoleId` + `PersonSkill` + realised hours/margin into one
   per-person view is closer to a new read screen (in the shape `lib/analytics.ts` just
   established this same day) than a schema change, since every fact it would show is already
   recorded somewhere.

Neither is built here — this is the comparison that was asked for, not a design for either. If
either is wanted next, it gets its own design doc, following this session's own convention.
