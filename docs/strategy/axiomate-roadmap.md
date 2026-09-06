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
artifact would capture, and this pass could not re-verify them live (they depend on Entra state
and a mailbox this session cannot reach):

- **A7 — invite the guest.** App side done (`PERSON_85`, the scoped boundary, `GA1` proves it);
  the Entra invite itself was deferred by the founder on 23 Aug and, as far as this document
  trail shows, still hasn't happened.
- **I2d — client mail intake may still be off.** As of 18 Aug both the app flag and the Logic
  App watcher were disabled after a mis-pointed mailbox produced 27 junk issues in a day; the
  fix needs a real shared mailbox address, not an individual's. If this is still off, **no
  client email has been arriving for three weeks** — worth a direct check before anything else
  in this roadmap, because it's a live gap in a shipped capability, not a backlog item.

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

- Confirm whether client-mail intake (I2d) is actually back on. If not, re-enabling it is
  higher priority than anything below — it's a regression in a shipped capability, not new work.
- A7, the guest invite — a five-minute Entra action, open three weeks.
- Decide whether `pending-actions.md` should be retired in favour of the artifact trail, or kept
  as the record of operational/human-side facts artifacts don't cover (recommendation: the
  latter, scoped down to exactly that — Entra/mailbox/deployment facts, not code status).
- Reconcile `axiomate-vision.md`'s twelve pillars against `axiomate-product-blueprint.md`'s
  twelve suites into one mapping, so "next" is read against one framework, not two. This is a
  real analysis task, not a rubber stamp — they don't line up one-to-one (e.g. the blueprint's
  Application Suite has no clean pillar home; the vision's pillar 2, Context Graph, has no clean
  suite home either).

### Next — real, unblocked, not yet built
Drawn from `axiomate-vision.md` §8's own read of where to go after this session's shipped work
(Today, Unified Inbox, Project Pulse, Zero-Entry Timesheet, Automatic Resource Replanning):

- **Pillar 9, Organizational Memory** — decisions and commitments already exist as concepts
  (`RaidKind`, `ChangeRequest`); making them queryable is structural work, not AI-blocked.
- **Pillar 11's remaining slice, Business Operations** — customer-facing external collaboration
  has a real access-control precedent already (the client-scoped guest role, `PERSON_85`/A7
  above), so extending it doesn't require new security architecture, just more of the same
  pattern.
- **D1/D2-shaped modelling questions** — the pattern in pending-actions.md's D2 (a taxonomy
  decision that looks like a config edit but isn't) recurs; any blueprint suite picked up next
  should expect at least one of these before implementation starts.

### Later — real, but blocked on AI credits
Everything in `axiomate-vision.md`'s MVP slice B (capture-and-understand from unstructured
signal), the AI-narrate button already wired and idle, and most of the new blueprint's
Intelligence Suite (INT-001 through INT-008) and Automation Suite's Agent Studio/Agent Workspace
(AUT-004/005) sit here. Not "someday" — genuinely ready to build the day credits exist, per
`axiomate-vision.md` §6's specific list of what agent orchestration additionally requires
(agent-attributed audit entries, agents as directory entries with roles — neither exists today).

### Someday — needs its own Intent pass first
The blueprint's suites that assume domain objects this codebase doesn't have at all: Growth
Suite (no Opportunity/Contract layer — this is a CRM, and Axiomate TMS is not one today),
Application Suite (no Application/Integration entities), and the capability-toggle idea from the
Hive-inspired proposals doc (`2026-09-06-hive-inspired-proposals.md`) — a real architectural
question about what a "tenant" can turn on or off, not a UI change. None of these should be
estimated before a Domain & Architecture Analyst pass, because the estimate would be guessing at
a data model that doesn't exist yet.

## What this roadmap deliberately doesn't do

No RICE scores, no team capacity in person-weeks, no committed dates. Those would all be
fabricated against a product with one real operator and an AI-agent build team whose throughput
this document has no measured basis for. What it offers instead: an honest ordering by what's
real, what's blocked, and what's still just an idea — and where the actual bottleneck sits
(approval bandwidth and API credits, not headcount).

## Recommended immediate next step

Two candidates, both cheap relative to their value:

1. Check whether client-mail intake is actually running (Now, above) — a live fact, not a
   planning exercise, and the closest thing to a fire in this list.
2. Do the pillar/suite reconciliation (Now, above) — everything in "Someday" and half of "Next"
   is easier to prioritize correctly once there's one map instead of two.
