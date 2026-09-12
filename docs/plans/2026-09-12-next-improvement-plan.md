# Next improvement plan — 12 September

*Not a new audit. `docs/audits/2026-09-12-enterprise-audit.md` already found and, mostly,
fixed the day's Critical/High work — its own Progress section is the record of that. This
plan starts from a line-by-line re-check of that file's still-open items against current
`HEAD` (`a03c211`), adds the one dimension the audit doesn't cover (the product roadmap), and
gives both a single order. Where a verdict below says FIXED or DECIDED-NO-ACTION for
something the audit listed as open, that reflects code read today, not the audit text.*

## What's actually still open (re-verified against HEAD, not the Progress section)

| ID | Verdict | State |
| --- | --- | --- |
| C4 | **PARTIAL** | `scripts/db-app-role.sql` fully defines the least-privilege `axiomate_app` role (NOSUPERUSER, `ScheduleAudit` UPDATE/DELETE revoked). It has not been run against production — `DATABASE_URL` is still `tmsadmin`. CI's RLS gate uses a *separate* role it creates inline; that proved the design, it didn't apply it. This is the one Critical-tier item still fully live. |
| H2 | DECIDED-NO-ACTION | Nishant: leave the database network as it is. |
| H4 | OPEN | No DR runbook, no rehearsed restore. `docs/deployment.md:466` is still the open action it always was. |
| H11 | OPEN | 38 uncapped `findMany` in `lib/db/repo.ts`; `buildTree` still O(n²). Unchanged. |
| H12 | OPEN (doc fixed) | One Entra secret still serves sign-in and app-only Graph. `docs/entra.md` no longer claims otherwise. |
| M3 | OPEN | No `Origin === publicOrigin` assertion anywhere. |
| M4 | OPEN | `expected` (optimistic-concurrency) still has its one call site, in `updateIssue` only. |
| M5 | OPEN, partially acknowledged | No retention pass or erasure procedure. `deletePerson`'s hard-delete is now *named* as the M5 gap in `pending-actions.md` (I34) rather than silently left — a decision to record the risk, not to close it. |
| M6 | OPEN | No migration-shape CI gate; the firewall-cleanup step still swallows failure (`deploy.yml:402 \|\| true`). |
| M8 | OPEN | Pre/post-swap checks are still an anonymous health/page-boot call, deliberately not a sign-in exercise (the code comments explain why an authenticated check was rejected — worth reading before "fixing" this one). No sticky-setting slot diff. |
| M9 | OPEN, worse | `ConfigWorkspace.tsx` 6,396 lines (flat), `IssueWorkspace.tsx` 3,274 (+24), `lib/workspace.ts` 9,917 (+27). No extraction started. |
| Low: backfill scripts bypass `withTenant` | OPEN | `scripts/backfill-person-ids.ts`, `scripts/backfill-project-members.ts` — would silently no-op under FORCE RLS. Quiet failure mode, not cosmetic. |
| Low: literal dev password, `npm ci --no-audit`, `tokenCrypto` no AAD, tracking pixels in email iframe, 401-queue has no reopen-sign-in link, refresh-token race | all OPEN | Unchanged from the audit. |
| Low: docs drift (ux-checklist.md, entra.md, postgres.bicep pool claim) | **FIXED** | Corrected in `151b9e8`. |

Today's CI/CD side-note, unrelated to the audit: the four `actions/*` deps and `azure/login`
were pinned to versions GitHub is force-running on a newer Node than they declare. Bumped to
v5 / v3 in `a03c211`; verified green end-to-end including a production swap. One cosmetic
annotation remains on `upload-artifact@v5` — its own `action.yml` still says `node20` despite
the v5.0.0 changelog claiming otherwise; there's no newer tag, and GitHub already silently
runs it on Node 24, so there's nothing to act on there.

## The other dimension: `docs/strategy/axiomate-roadmap.md`

The audit is entirely about what could break or leak. It says nothing about what to build.
The roadmap (6 Sep) already answers that, with two real constraints named explicitly:
founder gate-approval bandwidth (every decision above routes through one person) and zero
Anthropic API credits (blocks every generative feature). Its **Next** tier — unblocked,
buildable now — is Organizational Memory (pillar 9) and the Business Operations suite
(Client/Engagement/Finance). Everything past that is blocked on credits or an
architecture pass. That tier doesn't compete with the list above for engineering effort; it
competes with it for the one thing actually scarce here — decisions.

## Recommended order

Grouped the way the audit's own fix order was, because the shape of what's left is the same:
some of it is free, some of it needs one decision, some of it needs a window.

**Now, no decision needed — the cheap pass, same shape as today's run:**
- M3: assert `Origin === publicOrigin` on mutating routes.
- M6: a migration-shape check in CI; drop the `|| true` on firewall cleanup, fail the job on
  a non-404 delete error instead.
- Backfill scripts: wrap both in `withTenant` so a re-run fails loudly instead of no-op'ing.
- Low-hanging Lows: rotate/remove the literal `scripts/db-setup.sql` password, drop
  `--no-audit` from CI installs, bind AAD in `tokenCrypto`, add the reopen-sign-in link to the
  paused queue.

**This week, one decision each:**
- **C4 — apply, don't just prepare.** The script exists; the decision is when to point
  `DATABASE_URL` at `axiomate_app` and cut over. This is the highest-leverage item left: it's
  the one Critical still fully live, and the work is already done.
- **H12** — stand up a second Entra registration (certificate or workload-identity
  federation) for app-only Graph, separate from the sign-in secret. Needs Entra admin access,
  not engineering time.
- **M5** — decide the actual retention window and who owns subject-erasure requests before
  writing the daily-job pass; the code is straightforward once that's answered.
- **M9** — not a decision about *whether*, about *when*: `useIssueFilters` and
  `useWorkspaceDialogs` were sized by the audit as halving the hook count without touching the
  reducer. Worth doing before `IssueWorkspace.tsx` or `lib/workspace.ts` grow further, since
  every week without it makes the eventual extraction larger, not smaller.

**Planned, one maintenance window:**
- **H4** — the DR rehearsal. Point-in-time restore lands on a new server and Postgres holds
  the only `Document.locator` mapping to SharePoint, so this has to be rehearsed as one
  procedure restoring both stores to the same instant, not exercised as two.
- **H11** — drop audit rows from the boot payload, scope documents/notes to the viewed
  subject, index the child lookups `buildTree` walks. Worth bundling with the C4 cutover
  window since both touch the same request path under load.
- M4 (extend `expected` beyond `updateIssue`) and M8 (sign-in-aware slot-parity check) are
  real but lower-urgency engineering; fold into whichever window has room.

**Then, once the above is closed: the roadmap's Next tier.** Organizational Memory and the
Business Operations suite are the two pieces of product work that are actually unblocked
today — everything else on the roadmap is waiting on either an architecture pass or Anthropic
credits that don't exist yet, so there's no version of "do more roadmap work sooner" available
before those two.

## One process note

C4, H4, H11, H12, and the M-items above touch exactly what `docs/adr/0001-agentic-operating-model.md`
built its gates for — infra, migrations, and cross-cutting write-path changes. Today's audit
fixes went straight to `master` the way the fastest fixes always will when the person finding
them and the person approving them are the same, and that was the right call for same-day
Critical/High remediation. The items left, though, are lower-urgency and higher-blast-radius
(a database role cutover, a second Entra registration, a migration gate) — exactly the case
the intent-orchestrator → build-orchestrator → proof-orchestrator → release-orchestrator chain
and its five human gates exist for, rather than another ad hoc commit run. Worth routing C4 and
H4 through it in particular, if only to find out in practice whether the pipeline holds up on
something real.
