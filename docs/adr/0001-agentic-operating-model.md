---
artifact: ART-20260905-003
status: approved
date: 2026-09-05
---

# 0001. Adopt a four-orchestra agentic operating model with file-based contracts

## Context

Thirty-two `axiomate-*` skills, two agents and one adversarial-review workflow exist in
`.claude/`. Nothing sequences them with contracts, nothing records their outputs in a form the
next agent can consume, and nothing states which may act and which may only recommend. The
founder is the only human at every gate. The brief that prompted this asked for seven orchestras
and around forty agents on an ASP.NET Core and Azure DevOps stack; the codebase being committed
to is Next.js on GitHub Actions.

Full design: `docs/plans/2026-09-05-agentic-operating-model-design.md`.

## Decision

Four orchestras (Intent, Build, Proof, Release) laid over the existing
design → plan → build → proof → gate → deploy loop. Agents exchange artifact ids. Artifacts are
JSON files under `docs/artifacts/`, validated in the standing gate by
`scripts/contract-check.mjs` against `.claude/contracts/`. Five human gates, held by role:
specification, architecture, plan (only for protected paths and migrations), security (only on a
high finding), release. No agent merges to `master`, deploys, or approves an artifact it
produced. No new infrastructure until Phase 3 has a measured reason.

## Alternatives rejected

- **Seven orchestras as proposed.** Product, Architecture and UX read the same evidence and
  produce one approved specification; splitting them is three handoffs for a one-owner product.
  Deployment is a pipeline, not an agent. A continuous-improvement orchestra gives debt its own
  backlog, which is how it gets ignored.
- **A bus and an orchestration service from day one.** Nothing measured yet justifies it. Git
  and files give versioning, attribution, diff and a CI-enforceable contract check for free.
- **Designing for the .NET stack in the brief.** `AxiomateV1` has not been pushed since March
  2026. The design is host-agnostic; if V1 is revived, the environment approval and the pipeline
  port and the rest stands.

## Consequences

- Every commit on `master` should trace to an artifact id, and the pipeline gains one additive
  step. The Phase 1 success metric exists to catch artifacts being written and not read.
- All five gates are held by one person today. The model makes that legible and lets a second
  approver be added by editing a role, not by redesign.
- The specialists stay the existing skills. Nothing is duplicated; nothing existing is
  invalidated.

## Principles checked

None of the four product principles is touched: this decision changes how the product is
developed, not what the reducer, the schema or the tenancy layer do.
