# Override provenance and blast radius — implementation plan

**Design:** `2026-08-23-override-provenance-design.md` · **Date:** 2026-08-23

Ordering: the annotated twins and the radius proven pure before any chip renders, then the
screens, then the deploy. No reducer, wire, or storage change.

## Steps

**1. Sources + radius + OV1 — `lib/config.ts` (LF, Edit tool),
`scripts/scenario-validation.ts` (CRLF, python).**
`labelSource` / `agentEnabledSource` / `requiredSource` beside their resolvers, same walk,
returning `{ value, at }` (`at`: scope id | ROOT_SCOPE | null-for-shipped).
`blastRadius(options: { id; chain }[], at, sets)` → `{ affected, shielded: { id; by }[] }`;
a scope walks `[itself, ...chain]` and the first pin BEFORE `at` shields it. OV1 builds a
model with overrides at two nested scopes and asserts: every source kind produced; each
source's value === its resolver's answer (the anti-divergence check); root-change radius
shields the overriding branch naming the shield; mid-scope radius reaches only the
subtree; a self-pinned scope is shielded by itself.
*Verify:* `npm run validate:scenarios` → 92 scenarios, 0 FAIL parsed from JSON (python,
utf-8); OV1 PASS.

**2. The screens — `components/ConfigWorkspace.tsx` (CRLF, python), `app/globals.css`
(CRLF).
THE STEP CARRYING THE MOST REGRESSION RISK** — the Scopes screen is live configuration
surface; a wrong map over `model.overrides` renders every scope as overridden or none, and
the Terminology editor is where the firm's own words are set. The "Effective here" section
maps ALL label keys / agents / responsibilities through the sources with the selected
scope's chain; per-override rows call `blastRadius` with options built from the `scopes`
prop via `scopeChainOf` (computed once per render with `useMemo`, NOT per row); the
Terminology editor gains the radius line only when its target scope is not ROOT. Chip
wording exactly the design's four: `set here` / `from <name>` / `organisation default` /
`shipped default`.
*Verify:* `npx tsc --noEmit && npm run build` clean.

**3. Sweep, deploy, checklist section 28, push.**
Suite parsed, persistence 50, tenancy, attribution. Clean-room release → deploy → health →
push. Checklist 28: the Effective-here chips at a scope with and without overrides; a
radius line naming a shielded scope; the Terminology preview before a scoped save.

## Details most likely to be got wrong

- **The sources must not fork the resolvers** — same walk order (chain, then ROOT, then
  shipped); OV1's equality check is the guard, and any future resolver change must move
  both.
- **`blastRadius` walks `[scope itself, ...chain]`** — a scope that pins the key is
  shielded BY ITSELF, not affected; forgetting the self-check counts every overriding
  scope as affected.
- **Chains are fine → coarse** — the same direction `scopeChainOf` builds and the
  resolvers consume; reversing one silently inverts nearest-wins.
- **Options exclude ROOT** — the organisation default is the backstop, not a scope in the
  radius.
- **FAIL gates parse JSON** — python, utf-8 stdout.

## Commits

Step 1 alone. Step 2 alone. Step 3 with the checklist.

## What would send the design back

- Provenance wanted at the point of use (tooltips everywhere) — surfaces at checklist 28;
  a different, wider surface.
- Per-scope override permissions — a policy dimension the model does not carry.
