# Allocation hard cap — design

**Date:** 2026-08-23 · **Register item:** #4 · **Status:** approved

## What exists, and what this changes

The capacity judgement is already honest and stays untouched: `capacityFor`
(`lib/capacity.ts`) computes remaining **hours** from the person's working pattern across
overlapping allocations and commitments, so "overallocated" means genuinely more work than
days. A single allocation is already capped at 100% by `checkAllocation`.

What changes is the GATE over that judgement. Today it is advisory: `upsertAllocation`
refuses once, then `acceptOverallocation: true` commits anyway, audited as "Deliberately
overallocated", with the CapacityPanel form revealing "Commit anyway" only after a refusal.
The PRD's non-negotiable is 100% enforcement; this design makes the cap **hard by policy,
shipped hard**.

## The chosen approach, and the two rejected

**Chosen: the cap becomes policy.** `allocationPolicy: { cap: 'hard' | 'advisory' }` on the
OperatingModel. Hard is the shipped default — the PRD's rule — and advisory preserves
today's behaviour as a decision the firm makes once on a config card, rather than one every
allocator makes under deadline. The codebase's own argument for the override (assigning
somebody on leave is "sometimes exactly right" — the comment above `acceptOverallocation`)
survives as the advisory mode.

Rejected: **B**, hard always with the override deleted — erases a deliberate design and
strands firms that staff through go-lives with no way back short of a code change; and
**C**, louder warnings on the advisory gate — does not deliver the register item.

## The design

### 1. The policy

`model.allocationPolicy = { cap: 'hard' | 'advisory' }`, default `{ cap: 'hard' }`.
Declared beside the capacity rule it parameterises; merged in `mergeModel` exactly as
`timePolicy` is, so a stored model predating the key reads hard rather than `undefined`.
A new `setAllocationPolicy` config op (`{ k: 'setAllocationPolicy'; patch }`) validates the
value against the two-member union, refuses anything else in words, audits the change, and
answers "Nothing changed." when it is already so. No migration — the operating model is a
stored document.

### 2. The gate

In `upsertAllocation` (`lib/workspace.ts`, the `position.overallocated` branch): when the
policy is **hard**, refuse regardless of `acceptOverallocation` — the capacity sentence
(`describeCapacity(position)`) plus "This workspace enforces the allocation cap — free up
the person, shorten the window, or lower the share. The cap is set on the Configuration
screen, under Allocation." When **advisory**, today's two-step is untouched: refuse bare,
commit with the flag, audit the override.

`acceptOverallocation` stays on the wire in both modes — the shape does not narrow — and
the hard mode's refusal of it is the server half of both-halves; the UI half is §3.

### 3. The screens

- **The allocate form** (`components/CapacityPanel.tsx`, the one surface — DetailPanel
  composes it): "Commit anyway" renders only under advisory. Under hard, the refusal
  stands alone and the form keeps its values so the person can lower the share or shorten
  the window in place.
- **Configuration → Allocation** (a new card beside Time recording): the two modes in
  words — hard: "Nobody can be committed past their capacity, full stop."; advisory:
  "Over-capacity commitments warn, and can be accepted — each acceptance is recorded as a
  deliberate decision."

### 4. Grandfathering, stated

Existing over-allocations stand as records — the gate runs at write time, never as a
retroactive sweep. Editing one under hard is a new decision and must fit, which is the
point of the rule.

### 5. Proof

Scenario **AC1**, through the real ops: a person with a stated pattern; overlapping
60% + 60% refused under hard EVEN WITH `acceptOverallocation: true`, in words naming the
policy; `setAllocationPolicy` flips to advisory and the same allocation commits with the
override audited as "Deliberately overallocated"; flipped back to hard, refused again; the
single-allocation >100% refusal (`checkAllocation`) unchanged in both modes; an invalid
policy value refused by the op.

## Regression risk, named

The shipped default is **hard**, which changes live behaviour: the next over-capacity
allocation on the production workspace is refused until somebody frees capacity or sets
advisory on the card. That is the PRD's rule working, and it lands on whoever allocates
next — the card is the escape hatch, and the refusal names it.

## Out of scope, stated

- **Commitments** (leave, training) stay uncapped — they record absence, not work.
- **Per-project or per-person cap exceptions** — those reopen where the policy lives, not
  its value, and are a design question of their own.

## What would send this back

- The firm needing **per-engagement or per-person exceptions** to the cap.
- A wish for a **numeric cap other than 100%** (e.g. 80% billable ceiling) — that is a
  different policy shape, not a boolean hardness.
- Advisory-by-default wanted after all — a one-line default flip, but a product decision.
