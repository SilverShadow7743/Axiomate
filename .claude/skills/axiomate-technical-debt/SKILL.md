---
name: axiomate-technical-debt
description: This skill should be used when identifying, tracking, or prioritizing technical debt in Axiomate TMS — code, architecture, UI, test, data, or documentation debt. It aggregates the REAL debt items already identified by name across this project's other skills (the person/personId seam, the reduced-motion authoring split, the TW2 cap gap) rather than starting from a hypothetical list, and prioritizes by impact, not by what's easiest to log.
---

# Axiomate Technical Debt

**Start from what's already been found, not a fresh sweep.** Every skill built in this session
that touched real code surfaced at least one genuine debt item along the way — this skill's job
is keeping that list prioritized and current, not rediscovering it from scratch each time.

## Known debt, already named, by category

**Data** — the person/personId seam on `Allocation`, `Commitment`, `TimeEntry`, `Timesheet`
(`axiomate-domain-analysis`): name is the historical join, id is the migration target, and a
rename that updates only the name silently orphans anything still joined on it. This has
already caused a real incident (a directory entry left a person with zero permissions). HIGH
impact, not yet resolved — the clearest single item on this list.

**Data/reporting** — the same seam's downstream effect on `TW2` (`axiomate-timesheet`): the
long-day cap and warning is keyed off a resolvable `personId`, so a person whose `person`
string doesn't resolve gets no cap and no warning — silent, not a hard failure, which makes it
easy to miss.

**CSS authoring** — two competing `prefers-reduced-motion` patterns coexisted (gate-the-
declaration vs. override-to-none) until a UI/UX review caught the gap on `.focus`/`.cfg`
specifically (fixed 2026-08-31, commit `adc8645`). A house style is now documented
(`axiomate-ux-review`'s `accessibility.md`) — the remaining debt is confirming no other
component still uses the gate-the-declaration variant inconsistently.

**Documentation drift** — the design-system extraction's OWN first pass got two things wrong
(claimed no danger button existed when `.btn.danger-solid` already did; a stale session-memory
claim about `lib/timeWindow.ts` being unwired when it was actually live) — both corrected in
place rather than left standing. The lesson generalizes: a document describing "what's missing"
needs the same verification discipline as a document describing "what exists," or it becomes
its own debt.

**Refactoring safety** — the CRLF line-ending trap (`axiomate-refactoring`): a script-driven
edit that opens a file without explicit `newline=''` handling on both read and write silently
flips the whole file's line endings, producing a diff thousands of lines long for a
content-identical change. Happened twice in this project's history. Not fixed by a tool
change — fixed by discipline, which means it can recur if the discipline isn't followed.

## Categories from the user's proposal, and where they map

```
Code debt          — cite specific duplication/coupling, not "the code could be cleaner"
                      (axiomate-code-review's review process is where this gets FOUND;
                      this skill is where it gets TRACKED and prioritized)
Architecture debt  — a domain-model mismatch already shipped (check axiomate-domain-analysis's
                      "don't create a new entity" rule for anywhere it was violated before this
                      skill set existed)
UI debt            — axiomate-design-audit's drift findings (a two-idiom pattern not yet
                      unified)
Test debt          — a scenario marked PARTIAL or NOT TESTABLE in axiomate-scenario-testing's
                      suite that hasn't been revisited
Data debt          — the person/personId seam above, and axiomate-data-integrity's seven risk
                      areas — anywhere one of those checks would currently fail
Documentation debt — a doc/skill making a claim not verified against current code (see the
                      design-system correction above as the worked example of catching this)
```

## Prioritization — impact, not accumulation

A debt list that only grows is not being managed. For each item: what's the actual failure mode
if it's never fixed (not "it's untidy" — a concrete, named consequence, the way the
person/personId seam's consequence is "a real permissions incident already happened"), and what
would it cost to fix now versus after more code depends on the current shape. Rank by that, not
by how long an item has been on the list or how easy it is to log a new one.
