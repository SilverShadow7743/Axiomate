# Architecture decision records

One file per decision, numbered `NNNN-<slug>.md`, never renumbered. Each mirrors an
`architecture-decision` artifact in `docs/artifacts/` (the `artifact:` line in the frontmatter
names it, and the artifact's `body.adr_path` names the file), so the checker can see both and the
approval lives in one place: the artifact's `approvals`.

An approved ADR is not edited. A change of mind is a new ADR that says which one it supersedes,
and the old artifact's status becomes `superseded`. Rejected ADRs stay, because the rejection is
the useful half; the design docs in `docs/plans/` already work this way.

Format:

```
---
artifact: ART-YYYYMMDD-NNN
status: proposed | approved | rejected | superseded
date: YYYY-MM-DD
---
# NNNN. Title
## Context
## Decision
## Alternatives rejected
## Consequences
## Principles checked
```

The four product principles an ADR states it checked, where relevant: tenant isolation at both
layers, the pure reducer, attribution as a parameter, derived values never stored. An ADR that
touches none of them says so, as `0001` does.
