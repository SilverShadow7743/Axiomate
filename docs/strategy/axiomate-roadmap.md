# Axiomate — roadmap and backlog, reconciled against reality

*Recorded 2026-09-06. Adapted from a generic quarterly-roadmap framework (RICE scores,
person-week capacity, an 8-engineer team) that doesn't fit this project: Axiomate TMS has one
real operator today (`.env.example`: "with none of it set, the application runs from the seed
file, in one browser, as one configured operator"), is built by AI agents under a governed
pipeline (`docs/adr/0001-agentic-operating-model.md`), and its binding constraint is the
founder's own gate-approval bandwidth, not engineer throughput — the founder dependency inventory
in the office-axiomate repo (2026-09-05) rates product deployment, alerts, Entra administration
and product development all founder-only, the company at stage 1–2. Fabricating reach/impact
numbers against zero real users would violate the "never invent" rule this repo holds everywhere
else, so this roadmap uses status and blocking-dependency instead of RICE.*

## The three things called "the backlog" today

Before prioritizing anything, these need to be told apart — they overlap in places and
contradict each other in one:

1. **`docs/pending-actions.md`** — a hand-maintained list, last updated **17–18 August 2026**.
   Confirmed stale in this pass: it lists the scenario suite at 63 scenarios; the suite run today
   shows 225. It lists client-filter defaults (its D1/A4) as "requested and not yet built"; the
   real artifact trail (`ART-20260905-023`, status `approved`) shows it shipped three weeks ago.
   Treat this document as **superseded by the artifact trail below for anything the artifacts
   also cover**, and as the only record of a few things they don't (see "Still real from
   pending-actions.md" below).
2. **`docs/artifacts/*.requirement-specification.json`** — the live output of the
   `axiomate-change` workflow, running today. As of this pass it has already produced and
   approved specifications for accessibility/UX fixes, a timing-unsafe token comparison, wrong
   HTTP status codes, a missing database index, a batched-insert performance fix, and a required
   pattern for destructive schema migrations — all from an "industry-standard review" that ran
   this session, separate from anything in this conversation. **This is the real, running
   engineering backlog.** It does not need re-planning here; it needs to keep running.
3. **The two strategy documents** — `axiomate-vision.md` (31 Aug, twelve pillars, MVP slices
   A–E, honest about what's AI-blocked) and `axiomate-product-blueprint.md` (6 Sep, twelve
   suites, ~100 screens, target state). Both are aspirational and **unreconciled with each
   other** — see that doc's own header note. Neither has been checked screen-by-screen or
   pillar-by-pillar against the codebase.

**Still real from `pending-actions.md`**, because these are operational/human facts no code
artifact would capture — both now checked live against Entra/Azure via `az` (this session had
tenant access after all):

- **A7 — a real delivery problem, found 2026-09-07.** The Graph-side story (invited 31 Aug,
  resent 6 Sep, both confirmed) was only half the check. With the Gmail connector authenticated,
  a direct search of `nishant.ax@gmail.com` — inbox, spam, trash, all folders, no date bound —
  found **zero** invitation emails from either send. Not a spam-filter problem (spam is empty
  too); this points at Entra's outbound invitation mail not reaching Google's servers at all.
  This is now an email-deliverability investigation on the tenant side, not a "go click accept"
  task — see `pending-actions.md`'s A7 row for candidates to check (mail-flow/connector config,
  sender throttling, SPF/DKIM/DMARC on the invitation sender).
- **I2d — resolved, checked live 2026-09-06.** Checked directly against production via `az`:
  the `axiomate-intake` Logic App is `Enabled`, its trigger is `When_a_new_email_arrives_in_the_
  shared_mailbox` (confirming the required repoint away from an individual's mailbox happened),
  it is polling successfully every ~3 minutes today, and its last full successful run was
  2026-08-24 — consistent with no new client email since then, not with a broken pipeline. This
  item is closed; `pending-actions.md` is simply stale on it.

## What "capacity" means here

Not person-weeks. Two real constraints:

- **Founder gate bandwidth.** Five human gates exist (`docs/plans/2026-09-05-agentic-operating-model-design.md`
  Part 9), all currently held by one person. Gate 1 (specification) and Gate 5 (release) are
  where that time is worth most; gates 2–4 fire only on protected paths, migrations, or security
  findings. Planning more concurrent Requirement Specifications than one person can gate through
  in a day is the actual capacity ceiling, not implementer throughput — the implementers are AI
  agents and scale more easily than approvals do.
- **Anthropic API credits.** Zero today (`axiomate-vision.md` task #113). This blocks every
  generative feature — natural-language capture-and-understand (pillar 1's harder half), the
  AI-narrate button already wired in `PortfolioPanel.tsx`, and most of the Intelligence Suite in
  the new blueprint. It does not block anything that reads real structured data and presents it
  without generating prose — which is most of what has actually shipped this session.

## Horizons

### Now — decisions, not builds
Things that block other things and need a person, not an agent:

- **A7's invitation email isn't being delivered at all** (found 2026-09-07, checked via the
  Gmail connector directly) — this needs someone with Entra/Exchange mail-flow visibility to
  find why, not another resend. A third attempt without changing anything would likely just
  produce a third non-delivery.
- Decide whether `pending-actions.md` should be retired in favour of the artifact trail, or kept
  as the record of operational/human-side facts artifacts don't cover (recommendation: the
  latter, scoped down to exactly that — Entra/mailbox/deployment facts, not code status).
- ~~Reconcile `axiomate-vision.md`'s twelve pillars against `axiomate-product-blueprint.md`'s
  twelve suites~~ **Done, 2026-09-06** — `docs/strategy/axiomate-pillar-suite-mapping.md`. Four
  findings changed what's below: pillar 11 (Business Operations) was split into three suites
  (Client/Engagement/Finance) and should be planned as one stream, not three; the blueprint's
  Intelligence Suite does not actually cover the hardest, AI-blocked half of pillar 3 (capture-
  and-understand from unstructured text); Growth Suite has no pillar ancestor and is,
  substantively, a CRM — a build-vs-buy question given `office-axiomate/CLAUDE.md` already
  states Business Central and D365 Sales are not core Axiocloud capabilities; Application Suite
  also has no pillar ancestor but maps comfortably onto delivery/knowledge without that same
  tension.

### Next — real, unblocked, not yet built
Drawn from `axiomate-vision.md` §8's own read of where to go after this session's shipped work
(Today, Unified Inbox, Project Pulse, Zero-Entry Timesheet, Automatic Resource Replanning):

- **Pillar 9, Organizational Memory** — decisions and commitments already exist as concepts
  (`RaidKind`, `ChangeRequest`); making them queryable is structural work, not AI-blocked.
- **Pillar 11's remaining slice, Business Operations** (Client + Engagement + Finance suites,
  planned as one stream per the mapping above) — customer-facing external collaboration has a
  real access-control precedent already (the client-scoped guest role, `PERSON_85`/A7 above), so
  extending it doesn't require new security architecture, just more of the same pattern.
- **D1/D2-shaped modelling questions** — the pattern in pending-actions.md's D2 (a taxonomy
  decision that looks like a config edit but isn't) recurs; any blueprint suite picked up next
  should expect at least one of these before implementation starts.

### Later — real, but blocked on AI credits
Everything in `axiomate-vision.md`'s MVP slice B (capture-and-understand from unstructured
signal — this is the item the mapping doc's finding 2 says is **not** delivered by building the
Intelligence Suite as specified, and needs to be tracked here as its own line, not assumed
covered), the AI-narrate button already wired and idle, and most of the new blueprint's
Intelligence Suite (INT-001 through INT-008) and Automation Suite's Agent Studio/Agent Workspace
(AUT-004/005). Not "someday" — genuinely ready to build the day credits exist, per
`axiomate-vision.md` §6's specific list of what agent orchestration additionally requires
(agent-attributed audit entries, agents as directory entries with roles — neither exists today).

### Someday — needs its own Intent pass first
Application Suite (no Application/Integration entities exist in `prisma/schema.prisma`) and the
capability-toggle idea from the Hive-inspired proposals doc
(`2026-09-06-hive-inspired-proposals.md`) both need a Domain & Architecture Analyst pass before
anyone estimates them — the estimate would otherwise be guessing at a data model that doesn't
exist yet.

**Growth Suite sits in its own category, blocked on a business decision, not an architecture
pass.** It is substantively a CRM (pipeline, opportunity, proposal, contract workflow) with no
ancestor in `axiomate-vision.md`'s twelve pillars, and `office-axiomate/CLAUDE.md` already
records that Business Central and D365 Sales are not core Axiocloud capabilities — building one
inside Axiomate is a real alternative to buying or adopting an existing CRM for Axiocloud's own
sales process, and that call belongs to the business, not to a product blueprint. Nothing in
Growth Suite should move above this line until that's answered.

## What this roadmap deliberately doesn't do

No RICE scores, no team capacity in person-weeks, no committed dates. Those would all be
fabricated against a product with one real operator and an AI-agent build team whose throughput
this document has no measured basis for. What it offers instead: an honest ordering by what's
real, what's blocked, and what's still just an idea — and where the actual bottleneck sits
(approval bandwidth and API credits, not headcount).

## Recommended immediate next step

Client-mail intake is healthy and the pillar/suite reconciliation is done (both above). What's
left with real, immediate value:

1. **Diagnose why Entra's invitation mail to `nishant.ax@gmail.com` isn't being delivered** —
   confirmed absent from every folder including spam, across two separate sends. This needs
   Exchange/Entra mail-flow visibility this session doesn't have (bounce/NDR logs live on the
   sender side, not somewhere Graph's `/invitations` API surfaces them).
2. **The Growth Suite build-vs-buy question** (Someday, above) — a business decision, not
   something for Intent to resolve on its own, and it currently blocks the one blueprint suite
   with the most screens (GRT-001 through GRT-007).
3. When credits exist: pillar 3's capture-and-understand layer, tracked on its own (Later,
   above) rather than assumed to arrive as a side effect of building the Intelligence Suite.
