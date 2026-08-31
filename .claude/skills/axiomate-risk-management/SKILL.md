---
name: axiomate-risk-management
description: This skill should be used when identifying, scoring, or reporting on risks in Axiomate TMS. A real risk model already exists (lib/raid.ts — risks are work-type-tagged issues with a 0-5 exposure score mapped to Low/Medium/High/Critical bands), so this skill extends it rather than inventing a parallel risk-tracking concept. Load alongside axiomate-domain-analysis for how a risk sits in the work-item hierarchy.
---

# Axiomate Risk Management

**A real RAID model already exists — extend it, don't parallel it.** `lib/raid.ts`: risks are
regular `Issue` rows carrying a specific work-type tag, not a separate database model.

## The real model

- `RISK_TYPE_ID = 'WT_RISK'` and `DECISION_TYPE_ID = 'WT_DECISION'` — a risk (or decision) IS
  an issue, distinguished by its configured work-type, not a separate kind. `raidKindOf(model,
  typeLabel)` resolves a work-type label back to `'risk' | 'decision' | null`.
- `RAID_SCALE_MAX = 5` — likelihood and impact are each scored on a 0-5 scale.
- `exposure(...)` computes an `ExposureBand`: `'Low' | 'Medium' | 'High' | 'Critical'` from
  those two scores — the real severity classification for a risk, distinct from
  `axiomate-domain-analysis`'s `Severity` type (`High/Medium/Low` on issues generally) and from
  schedule health (`axiomate-domain-analysis`'s `--h-*` family, a UI/status concept). Three
  different severity-shaped concepts exist in this app; don't conflate exposure with either of
  the other two.
- `raidProblem(patch)` — the validation/refusal path for a risk update.

## What this means for building a risk feature

1. **A new "risk category" is a work-type**, configured the same way any other work type is
   (Configuration → Work types), not a new field or table. Check whether the categorization
   need fits the existing `WT_RISK` tag plus a custom field, before proposing new schema.
2. **Risk placement follows the same hierarchy rules as any issue** —
   `canParent`/`axiomate-work-model` — a risk sits under a tier or a parent issue exactly like
   any other issue does; there's no separate risk-placement rule to design.
3. **Exposure, not raw likelihood×impact, is the reportable number.** Present the band
   (`ExposureBand`), not a bare product of two scores — the band is what the rest of the app
   already understands as the risk's severity.
4. **Decisions are the RAID model's other half** — `WT_DECISION`. A feature that surfaces risks
   without also surfacing decisions (the "D" in RAID) is missing half of what this model
   already supports.

## Risk categories from the user's proposal, mapped to what's real

Resource risks (capacity shortfall — cross-reference `axiomate-capacity-planning`'s formula),
schedule risks (`criticalBlockingDependency` from `axiomate-scheduling`'s
`criticalResolutionPath` IS a real, computable schedule risk signal), dependency risks (the
same function's `chain`/`sufficient` fields), delivery risks
(`axiomate-delivery-planning`'s achievability check), technical/capacity risks — all of these
are lenses on the SAME underlying `WT_RISK`-tagged issue plus, where relevant, a cross-reference
to another skill's real signal (capacity shortfall, critical-path blockage). Don't build five
separate risk-tracking mechanisms for five risk categories; tag the issue, and let the category
inform which other skill's data gets attached to it as evidence.
