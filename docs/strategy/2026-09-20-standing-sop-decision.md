# Standing operational SOP — ownership and sequencing decision

32-area review, area 29 (P2): only one dated, narrowly-scoped verification checklist existed —
nothing for rollback, secret rotation, or on-call escalation. Coverage Roadmap Tier 6 named this
as needing a decision this document could not make on its own: who owns it, and what's written
first.

## Decided (20 September 2026)

**Owner: Operations / Managed Service Owner.** They own the standing operational runbook set and
are responsible for keeping it current as the deployment changes.

**First runbook: Production Incident & Recovery**, not secret rotation. Rationale, stated by the
decision-maker: incident/recovery establishes what happens when something actually goes wrong —
the operational foundation everything else sits on. Secret rotation is a real, important
maintenance procedure, but a maintenance procedure, not the foundation.

**The full ordered set**, this pass's first document in bold:

1. **Production Incident & Recovery** — written, `docs/ops/production-incident-recovery-runbook.md`
2. Rollback / Release Recovery — largely covered already by `docs/deployment.md` §6–§7; not yet
   pulled into its own standalone document
3. On-call & Escalation — not written
4. Backup / Restore — not written
5. Secret & API-key Rotation — not written
6. Scheduled Automation Failure — not written
7. Access / RBAC Changes — not written
8. Deployment / Release Procedure — largely covered already by `docs/deployment.md` §3; not yet
   pulled into its own standalone document

## What this decision does not do

It does not write runbooks 2 through 8. Two of them (2 and 8) already have most of their content
in `docs/deployment.md`, discovered while writing runbook 1 rather than assumed beforehand — worth
knowing before someone starts either from a blank page. The other five are genuinely unwritten.
Not committing to a timeline for them here; naming the gap so it isn't mistaken for closed.

## Source

The full ordered list, the eight-phase incident flow (Detect → Assess → Contain → Communicate →
Recover/Rollback → Validate → Close → RCA), and the ownership call are the decision-maker's own,
given directly in response to the Coverage Roadmap's Tier 6 item. Recorded here rather than only
acted on, per this repository's own principle 10 (traceability between decisions and source
information).
