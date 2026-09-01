---
name: axiomate-deviation-diagnosis
description: This skill should be used when a person reports that Axiomate TMS is doing something wrong — a screenshot, an error, "this looks off", a stale scenario claim — and the task is to find out what actually diverges from what the product should do, why, and fix it safely. Formalizes the evidence -> root cause -> correction -> impact -> regression loop this project has run by hand on every bug fix and stale-claim correction to date (Owner/Process Area/Move, scenarios G/Z/B, the Configuration nav-gating fix). Not for building new features — that is `superpowers:brainstorming`.
---

# Axiomate Deviation Diagnosis

A person's report ("this screenshot looks wrong") is **evidence that a deviation exists**, not a
diagnosis of what it is. This project's real, repeated failure mode is guessing at the fix from
the report alone — every stale-claim correction this project has made (scenarios G, Z, B; the
"still free text" owner-column claim) was a case of trusted prose that no longer matched real
code. The discipline below is what avoided repeating that mistake, made explicit so it keeps
being followed rather than reinvented each time.

## The loop, and what already does each stage in this codebase

There is no literal "knowledge graph" or "engine" running these stages as code — that would be
inventing infrastructure this project does not have. What's below is the real, already-used
mechanism for each stage. Where none exists yet, that's stated plainly rather than papered over.

1. **Product understanding** — what the product is *supposed* to do, independent of what it
   currently does. Real sources, in order of authority: `CLAUDE.md`'s resource-model section,
   `axiomate-domain-analysis`/`axiomate-work-model` (the four-layer resource model, `canParent`'s
   tier rules), `docs/design/*` (information architecture, navigation model, component
   standards), and each scenario's own title + summary in `scripts/scenario-validation.ts` — 206
   of them, each stating a real business outcome, not a UI description.

2. **Behaviour understanding** — what the product *actually* does, read from the real code, not
   assumed from a comment, a scenario's prose, or a doc. This is the single most-skipped step
   and the one this project has been burned by most: `lib/automation.ts`'s own header comment
   asserted a limitation its own `DEFAULT_AUTOMATION_RULES` two lines away already disproved;
   three separate scenarios (G, Z, B) carried claims a later feature had already closed. Read the
   function the claim is about before trusting the claim.

3. **Deviation detection** — where product understanding and real behaviour disagree. A
   deviation is not automatically a bug: `canParent`'s "tiers skip freely among coarser tiers" is
   surprising on first read of a row menu but is documented, intentional design, confirmed
   correct before anything was touched. Distinguish a real defect from a design decision that
   merely looks wrong out of context — read the comment next to the rule before concluding it's
   broken.

4. **Root cause reasoning** — trace the deviation to the exact function, permission check, or
   config value responsible. Grep and Read, not inference: `mayInternal` gating `Configuration`
   turned out to be one string away (`internal.view` vs. the already-defined `config.manage`) —
   found by reading `lib/access.ts`'s `PERMISSION_KEYS` and `DEFAULT_GRANTS`, not by guessing
   what permission "should" exist.

5. **Correction planning** — classify the fix the same way `superpowers:brainstorming` does
   (Bounded vs. Architectural) and get explicit confirmation of scope before touching code,
   especially when a report names more than one thing. `AskUserQuestion` is the real mechanism:
   ask what's actually wrong when a report is ambiguous (a screenshot with three separate
   annotations is not one bug), and confirm the intended behaviour (warn vs. refuse, rename vs.
   re-scope) before writing it.

6. **Impact analysis** — what does this correction change for who, right now, in the real
   system — not just in the reducer's pure logic. A permission-gating fix in particular needs a
   live check, not a theoretical one: before restricting `Configuration`'s nav link to
   `config.manage`, query the real production grants (`loadWorkspace` + `rolesFor`/`can` against
   the live tenant) to confirm the signed-in user and anyone else who should still see it, still
   will. Skipping this step turns a correct permission model into a self-inflicted lockout.

7. **Validation & regression** — the standing gate is the floor, not the ceiling, for anything
   claiming "regression tested": `npx tsc --noEmit`, `npm run validate:scenarios` (exact count,
   0 FAIL), `npm run audit:a11y` when UI changed, `npm run build` — plus, for anything touching
   permissions, persistence, or tenancy, the full audit surface: `audit:tenancy`,
   `audit:attribution`, `audit:restore`, `audit:estimation`, `audit:persistence`,
   `audit:discussion`, `audit:rls`, `audit:integrity` (the last three against the real database;
   `audit:integrity` reads live production data, read-only). Then the staged deploy's own
   verification: health-check by response *body* (`"database":"connected"`, not just HTTP 200),
   and grep the deployed bundle for the actual changed string — confirms the fix is running,
   not just that the build succeeded.

## What feeds this, in this codebase's own terms

```
Application   — components/ (UI), app/api/* (endpoints), lib/ (reducer, pure domain logic),
                prisma/schema.prisma (DB), lib/db/schedule.ts (the scheduled pass / jobs)
Evidence      — scripts/scenario-validation.ts's PASS/PARTIAL/FAIL verdicts, the audit:* scripts'
                output, a user's screenshot or bug report, npm audit / eslint findings, the live
                /api/health check, application logging (enabled — a repeat failure now leaves a
                trace where an earlier one left none)
```

## Process

1. Treat the report as evidence, not a spec. If it names more than one thing or is ambiguous
   about which part is the actual problem, ask — don't fix the first plausible reading.
2. For each named issue: read the real code path before concluding anything, including whether
   the report itself is accurate (a report can be about stale behaviour that a later feature
   already fixed, or can describe intentional design).
3. Present the fix's scope and get confirmation before writing code, the same gate
   `superpowers:brainstorming`'s Bounded path uses — a short description in chat is enough for a
   small, well-scoped correction; do not skip the gate because the fix looks obvious.
4. For anything gating access or changing what someone can see/do, check the real, current
   effect on real accounts before shipping — not just that the logic is correct in the abstract.
5. Run the standing gate. For permission, persistence, or tenancy-adjacent changes, run the full
   audit surface, not just the minimum gate.
6. Deploy through the established staged recipe and verify against the live app — health check
   by body, and grep the deployed bundle for the actual change, not just "the deploy succeeded."
