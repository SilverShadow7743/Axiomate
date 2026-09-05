# Agentic operating model — Phase 1 implementation plan

Follows `2026-09-05-agentic-operating-model-design.md` (proposed 2026-09-05; the ADR it records
is `docs/adr/0001-agentic-operating-model.md`, awaiting the architect gate). Ordering principle,
as always: provable before anything depends on it. Contracts and the checker first, because
every later step produces an artifact the checker must accept; agents next, because the workflow
dispatches them; the workflow last, because it is the only step that needs everything else.

Nothing in this plan touches product code, the reducer, the schema or a migration. The one
pipeline change is additive (one step). No commit boundary carries a migration.

## Step 1 — Contracts and registry (pure data, no code)

Add `.claude/contracts/`:

- `envelope.schema.json` — the fields every artifact carries (Part 6 of the design).
- One `<kind>.schema.json` per artifact kind, eight in all, each describing `body` only.
- `registry.json` — the agent registry: name, orchestra, governance level, artifact kinds
  produced and consumed, what implements it; plus the gate roles per kind, the evidence kinds
  that never take `approved`, and the protected paths from Part 7.
- `README.md` — how to read the folder.

**Verify:** `node -e "for (const f of require('fs').readdirSync('.claude/contracts').filter(f=>f.endsWith('.json'))) JSON.parse(require('fs').readFileSync('.claude/contracts/'+f,'utf8'))"` exits 0.

## Step 2 — The contract checker (code, provable alone)

`scripts/contract-check.mjs`, dependency-free. For every `docs/artifacts/*.json`:

1. Filename is `<id>.<kind>.json` and matches the envelope's `id` and `kind`.
2. Envelope validates against `envelope.schema.json`; `body` validates against the kind schema.
3. Every id in `traces` exists in the folder and is not `superseded`.
4. `producer.agent` is registered and registered to produce this kind.
5. Evidence kinds are never `approved`; gated kinds at `approved` carry an approval whose `role`
   is one the registry allows for the kind, and whose `by` is not a registered agent.
6. An Implementation Plan whose `protected_paths_touched` is non-empty or whose `migration` is
   true needs the `architect` role; workstreams' `owns` lists are pairwise disjoint.

Exit 1 with every failure listed, file and rule, or exit 0 with a count. Wired as
`npm run audit:contracts`.

**Verify:** `npm run audit:contracts` against an empty `docs/artifacts/` exits 0 with "0
artifacts"; a deliberately broken file (wrong kind in filename) exits 1 naming the rule.

## Step 3 — First artifacts (data; proves the checker on real work)

`docs/artifacts/` with a README and three instances drawn from work that already happened, so
the checker is exercised on something true rather than a fixture:

- `ART-20260905-001.requirement-specification.json` — the status rollup, approved by the
  product owner on 2026-09-02 (evidence: the design doc).
- `ART-20260905-002.implementation-plan.json` — its plan, which touches `lib/types.ts` (a
  protected path) and therefore carries an architect approval, evidence the plan doc.
- `ART-20260905-003.architecture-decision.json` — this operating model, `proposed`, awaiting
  Gate 2. It stays `proposed` until a person edits it.

**Verify:** `npm run audit:contracts` reports 3 artifacts, 0 failures. Flip `002`'s approval
role to `engineering-lead` and it fails on rule 6; flip it back.

## Step 4 — The ADR log (data)

`docs/adr/README.md` (format, numbering, the rule that an approved ADR is never edited) and
`docs/adr/0001-agentic-operating-model.md`, the decision to adopt this model, mirroring `003`.

**Verify:** the ADR's frontmatter `artifact:` field names `ART-20260905-003` and that file's
`body.adr_path` names the ADR; `npm run audit:contracts` still green.

## Step 5 — Four orchestrator agents (Claude Code agent definitions)

`.claude/agents/intent-orchestrator.md`, `build-orchestrator.md`, `proof-orchestrator.md`,
`release-orchestrator.md`. Each states: mission, governance level, the artifacts it reads and
writes (and the folder it may write to), the skills it dispatches in order, and the condition on
which it must stop and return a `proposed` artifact for a human. None may set
`status: approved`. Existing agents `ui-ux-architect` and `enterprise-ux-reviewer` are unchanged;
the Intent Orchestrator dispatches the former.

**Verify:** each file's frontmatter parses (`name`, `description`, `tools`); `grep -l "status: approved" .claude/agents/*orchestrator*.md` returns nothing except inside a "never" sentence.

## Step 6 — The `axiomate-change` workflow (the only step needing everything above)

`.claude/workflows/axiomate-change.js`, plain JavaScript, three stages selected by
`args.stage`:

- `intent` — three analysts in parallel (requirement, domain & architecture, UX placement),
  then the Intent Orchestrator writes a Requirement Specification (`proposed`) and a Risk
  Assessment (`final`), runs the checker, and returns the ids. Stops there: Gate 1 is human.
- `build` — reads the approved specification (returns early if not approved), the Planner
  writes an Implementation Plan; if the plan needs Gate 3, returns; otherwise Implementers run
  the plan's steps in order on a branch, each step's verify command must pass, then the
  Adversarial Reviewer's find → refute pattern from `axiomate-tms-audits.js`, then a Change Set.
- `proof` — the Gate Runner executes the standing gate and records exit codes, the Security
  Reviewer reads the diff, and the Proof Orchestrator writes a Validation Result.

Timestamps and the next artifact sequence number arrive via `args` (the workflow runtime has no
clock). No stage merges to `master`; no stage sets `approved`.

**Verify:** `Workflow({scriptPath, args:{stage:'intent', request:'<a small real request>', today:'YYYY-MM-DD', seq:4}})` produces `ART-…-004.requirement-specification.json` with `status: proposed` and the checker passes. Then `stage:'build'` with that id returns `awaiting: product-owner` without writing a plan.

## Step 7 — Wire the gate and point the docs at it (additive)

- `.github/workflows/deploy.yml`: one step, `npm run audit:contracts`, beside the four
  database-free audits.
- `package.json`: the `audit:contracts` script (done in Step 2).
- `docs/continuous-development.md`: a short section after "Cadence" naming the artifacts as
  the loop's handoff record and linking the design.
- `CLAUDE.md`: a two-line pointer so every session knows the contracts exist.

**Verify:** `git diff --stat` shows only additive changes in those files; `npm run audit:contracts` green.

## Highest-regression-risk step

Step 7's pipeline change. It is additive and runs before the build, so a checker bug fails the
deploy of unrelated work. Mitigation: the checker exits 0 on an empty folder and on the three
real artifacts before the step is added, and the step is placed with the other pure audits so a
failure reads the same way as theirs. Rollback: delete the step.

## Commit boundaries

1. Steps 1–4 together: contracts, checker, artifacts, ADR. Meaningless in halves.
2. Step 5 alone: the agents.
3. Step 6 alone: the workflow.
4. Step 7 alone: the pipeline step and the doc pointers, so it can be reverted independently.

## What this plan deliberately leaves out

Parallel worktrees per workstream, the Scenario Author, the pre-commit hook and the
derived-value gate are Phase 2 (design Part 12). Headless runtime, Service Bus and AI Search are
Phase 3. None of them is needed to prove that a request can travel to a validated change set
through checked artifacts, which is what Phase 1 has to show before anything else is built.
