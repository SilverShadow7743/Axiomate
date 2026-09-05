# Artifacts

The handoff record between the orchestras. One JSON file per artifact, named `<id>.<kind>.json`,
validated by `npm run audit:contracts` (`scripts/contract-check.mjs`) against
`.claude/contracts/`. Agents pass ids, not prose; a person approves by editing `status` and
adding an entry to `approvals` with the evidence for the decision.

Ids are `ART-YYYYMMDD-NNN`, sequence per day. An approved artifact is never edited; a change is
a new artifact that `supersedes` it. Prior versions of anything live in git.

| Kind | Who writes it | Who approves it |
| --- | --- | --- |
| requirement-specification | Intent Orchestrator, Incident Analyst | product-owner |
| architecture-decision | Domain & Architecture Analyst | architect |
| implementation-plan | Implementation Planner | engineering-lead; architect if a protected path or migration |
| change-set | Build Orchestrator | nobody; evidence |
| validation-result | Proof Orchestrator | nobody; evidence |
| risk-assessment | Intent or Proof Orchestrator | nobody; evidence |
| release-decision | Release Orchestrator | release-approver |
| incident-report | Post-release Watcher, Deviation Diagnoser | nobody; evidence |

The first three here are not fixtures. They record the status-rollup work of 2 September and the
decision to adopt this operating model, so the checker is exercised on something that happened.
