# Hive-inspired proposals — backlogged, not commissioned

**Status: reference only, 2026-09-06.** Pasted across three messages in one session: a Hive
project-directory screenshot ("Enhancement #2 — Project Navigator"), a follow-up feature audit of
Hive (project creation, task-modal detail, portfolio rollup grid, six-view visualization,
app-toggle extensibility model, administration menu), and — separately — a Settings Architecture
proposal against a generic profile-menu screenshot. The Settings Architecture piece was
implemented the same session (`components/UserMenu.tsx`, `lib/theme.ts`); this doc is the record
of the rest, checked against the real codebase rather than acted on, per the operating model's
rule that product memory lives in a dated design doc, not in chat history.

This is not a Requirement Specification. Nothing here has been through Gate 1. If any section
below is picked up for real, it should enter `axiomate-change` normally — several sections touch
ground the codebase has already ruled on once (below), which is exactly the kind of conflict
Intent's analysts exist to surface rather than re-litigate silently.

## What the proposal gets right

Hive's three-pane project directory (nav / list / contextual panel) and its "project as the
entry point into delivery, not just a task list" framing both match where this codebase is
already headed — see `docs/plans/2026-08-22-hive-layout-attention-plan.md`, whose Week 2 ("the
Hive layout grammar") is confirmed **done**: My Work is the landing view, Portfolio is a real
panel, the record carries a persistent field strip. The proposal is describing a direction this
repo already committed to, not a new one.

## Where it re-opens a decision already made

**The 🟢/🟡/🔴 per-project health score is the literal pitch `docs/plans/2026-08-31-project-pulse-design.md`
considered and rejected**, on the record, for a stated reason: `lib/portfolio.ts`'s own header
comment describes a prior incident where a hidden severity weighting inside a "no priority score"
feature caused real confusion, and the lesson taken was "name the concerns, count them, and let
the reader do the weighing" — not colour-code them. `concernsFor()` already ships six named,
counted concerns (`overdue`, `forecast`, `capacity`, `blocked`, `unowned`, `stale`) instead. A
"Project Health: 🟢 Healthy / 🟡 Needs Attention / 🔴 At Risk" card is a step backward from that
decision, not an extension of it, unless someone brings a new argument for why this surface is
different — that argument doesn't exist yet.

**Capacity/allocation percentages shown per project** ("Capacity 82%", "96%") need to go through
the resource model in `CLAUDE.md`: capacity is computed (`lib/availability.ts`) from `Allocation`
plus working pattern, **never stored**, and `Allocation` is project-level while `Assignment` is
work-level — a project card showing "82% utilised" has to sum real `Allocation` rows for people
under that project, not invent a project-level capacity field. `2026-08-31-project-pulse-design.md`
already did exactly this derivation once, for the `capacity` concern; a Project Navigator card
should reuse `availabilityFor()`, not re-derive it.

## Where it substantially already exists, just not as pitched

- **"Command Search" / command palette** — `docs/plans/2026-08-27-assistant-command-palette-design.md`.
  What exists is a verb-triggered command grammar (`new|create|log …`, `<ID> field=value`, bare
  text as search) behind the Assistant, not a fuzzy Projects/Work Items/People index — a real
  gap against the proposal's mockup, but not a blank page.
- **"Allocate Resources" flow** — the domain objects (`Allocation`, `availabilityFor`) exist;
  what's missing is only the UI surface the proposal sketches (search people/skills, see
  available hours, allocate). This is the one part of the proposal closest to a straightforward
  build, because it adds a screen over real data rather than a new concept.
- **Trash/Archive, Workspace Settings, Roles & people** — see `components/ArchivePanel.tsx` and
  `components/ConfigWorkspace.tsx`, now reachable from the avatar menu as of this session.

## Genuinely new ground

- **Modular capability toggles** (Messaging / Portfolio View / Project Linking / Risks and Issues
  / Time-tracking / Workflows / Git-Jira connectors / Goals, each independently on/off) — not
  checked against `lib/access.ts` or `ConfigWorkspace` in this pass. This is a real architectural
  question (a feature-flag layer per tenant) worth its own Domain & Architecture Analyst pass
  before anyone estimates it, not a UI change.
- **Multiple project views (Table/Card/Portfolio/Timeline) with a project directory table**
  (health, owner, team, progress, capacity, due, status columns) — no equivalent exists; this is
  new screen work, not re-wiring.
- **Per-project card UI, contextual right-panel that changes by view** — new, and the
  "context panel" idea (calendar when on My Work, insights when on Projects, resource overview
  on a person) is a reasonable pattern but has no existing analogue to anchor it to.

## Not re-verified in this pass

Whether a RAID/risk tracker, time-tracking, or project-linking already exist under different
names (several `docs/plans/*raid*` and `*allocation*` files suggest at least RAID does) was not
checked file-by-file for this doc — flagging so nobody re-reads this list as a complete gap
audit. A real Requirement Specification would need that check done properly, the way this doc
did for health-scoring and capacity.

## What would send this back

- If a real argument exists for why project-level health should be scored/coloured where
  portfolio-level concerns deliberately are not, that argument needs to be made explicitly against
  `project-pulse-design.md`'s reasoning, not assumed by building it.
- If the capability-toggle idea is pursued, it needs its own design before implementation — it
  changes what `ConfigWorkspace` and `lib/access.ts` mean per tenant, which is exactly the kind
  of change the protected-path gate in the agentic operating model exists for.
