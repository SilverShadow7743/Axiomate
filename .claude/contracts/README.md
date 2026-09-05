# Contracts

What agents hand each other. An artifact is a JSON file at `docs/artifacts/<id>.<kind>.json`;
`scripts/contract-check.mjs` (`npm run audit:contracts`) validates every one against the schemas
here and the rules in `registry.json`. The design is
`docs/plans/2026-09-05-agentic-operating-model-design.md`, Part 6.

| File | Holds |
| --- | --- |
| `envelope.schema.json` | The fields every artifact carries: id, kind, version, status, producer, created, title, traces, supersedes, approvals, body. |
| `<kind>.schema.json` | The `body` of one artifact kind. Eight kinds: requirement-specification, architecture-decision, implementation-plan, change-set, validation-result, risk-assessment, release-decision, incident-report. |
| `registry.json` | The agent registry (name, orchestra, governance level, kinds produced and consumed, what implements it), the gate roles per kind, the evidence kinds that never take `approved`, and the protected paths. |

Rules the checker enforces beyond the schemas:

1. Filename matches the envelope's `id` and `kind`.
2. Every trace id exists. A `draft` or `proposed` artifact may not trace a `superseded` one; an approved, final, rejected or superseded artifact keeps its traces as history.
3. The producer is registered and registered to produce that kind.
4. Evidence kinds (`change-set`, `validation-result`, `risk-assessment`, `incident-report`) are
   `draft`, `final` or `superseded`, never `approved`.
5. A gated kind at `approved` carries an approval whose `role` the registry allows for that
   kind, and whose `by` is a person, not a registered agent.
6. An implementation plan touching a protected path or carrying a migration needs the
   `architect` role; its workstreams' `owns` lists do not overlap.

Schemas are JSON Schema draft-07 so an off-the-shelf validator can replace the hand-rolled one in
the checker without changing a schema. The checker deliberately depends on nothing.
