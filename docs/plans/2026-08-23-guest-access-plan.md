# Guest access — implementation plan

**Design:** `2026-08-23-guest-access-design.md` (approved) · **Date:** 2026-08-23

Ordering: the scoped withholding and every caller of the old signature move together with
the proofs that drive them — a signature change shipped in halves is a compile error at
best and an unscoped leak at worst; then the screens and the runbook; then the deploy. The
real-guest half of the verification waits on an admin action only the operator can take.

## Steps

**1. The scope, end to end — `lib/config.ts` (Person), `lib/workspace.ts` (upsertPerson
merge), `lib/clientBoundary.ts` (the signature), `lib/db/boot.ts` (the reader's scope),
`scripts/scenario-validation.ts` (GA1 + CB1 update), `scripts/persistence-proof.ts` (the
payload case passes the marked record's client).
THE STEP CARRYING THE MOST REGRESSION RISK** — it changes what every non-internal reader
receives, and the deny-by-default branches are exactly the ones nobody notices when wrong:
an unmatched reader seeing everything is silent, an internal reader seeing nothing is
loud. `clientView(state, clientScopeId: string | null)`: null → every content table empty
(the two deny cases share it); a node id → surviving issues additionally require the scope
node on their ancestor chain. `redactForReader` resolves the person and passes
`person?.clientScopeId ?? null`. GA1 drives: OAPIL-scoped sees OAPIL's marked and not
another client's; unscoped client role → empty; internal untouched; ancestors kept,
siblings absent. CB1 updated to set Carol's scope through the real op.
*Verify:* `npx tsc --noEmit`; `npm run validate:scenarios` → 95 scenarios, 0 FAIL parsed
(python, utf-8); `npm run audit:persistence` → 51 with the payload case now scoped.

**2. The screens and the banner — `components/ConfigWorkspace.tsx` (CRLF, python),
`lib/db/boot.ts`.**
Roles & people: a client-node select per person, rendered only when the person holds a
client role, dispatching `upsertPerson` with `clientScopeId`. The boot banner: when the
view was emptied because a client-role seat has no scope, `persistence.note` carries the
design's sentence — loud, not blank.
*Verify:* `npx tsc --noEmit && npm run build`.

**3. Runbook, checklist §32, sweep, deploy, push — `docs/guest-access.md` (new),
`docs/verification-checklist.md`.**
The runbook per the design. Checklist §32 names the two halves: the operator's admin
invite (nishant.ax@gmail.com as B2B guest) and the guest sign-in from a separate profile;
the `#EXT#` claim check happens against that real token. Full sweep, clean-room release,
deploy, health, push.

## Details most likely to be got wrong

- **The two deny cases share the null branch** — an unmatched reader and an unscoped
  client seat both pass null; only the BANNER distinguishes them, never the payload.
- **The subtree test walks the ISSUE's ancestor chain** through `state.nodes` — testing
  the node id prefix would couple to id formats.
- **Internal readers must not pass through the scope** — the `internal.view` verdict
  branches BEFORE `clientView` is called, unchanged.
- **Every `clientView` caller moves in step 1's commit** — boot, CB1, the payload proof;
  a missed caller is a compile error, which is the point of the signature change.
- **FAIL gates parse JSON** — python, utf-8 stdout.

## Commits

Step 1 alone (the risky one). Step 2 alone. Step 3 with the checklist.

## What would send the design back

- Multi-client people — surfaces at the directory screen (step 2); the field becomes a
  list.
- Per-engagement scoping — surfaces at §32 with the real guest.
