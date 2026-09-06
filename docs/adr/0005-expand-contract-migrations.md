---
artifact: ART-20260906-058
status: approved
date: 2026-09-06
---

# 0005. Require expand/contract sequencing for destructive schema migrations

## Context

The 2026-09-06 industry-standard review's Prisma/Postgres conventions dimension raised a HIGH
finding: nothing in this repository's process states that a migration destroying or renaming a
column must ship no earlier than the application code that stops needing the old shape.

The concrete incident is `20260826000002_rich_content_json`. It added
`Issue.description_new` / `IssueNote.body_new`, backfilled them from the plain-text originals,
then — in the *same* migration — dropped `description`/`body` and renamed the new columns into
place. That migration landed on production while the deployed application was still the
pre-rich-content build, which read and wrote `description`/`body` as plain strings. Per its own
emergency revert's comment (`20260826000003_revert_rich_content_json`):

> That migration landed on the live production database while the deployed app
> (axiomate-tms.azurewebsites.net, same database) was still the pre-rich-content build, which
> reads/writes Issue.description and IssueNote.body as plain strings. Two live risks followed
> immediately: the deployed Overview tab would throw trying to render a JSON object as a React
> child, and the intake mailbox watcher (polls every 3 minutes) would write plain strings into
> the new Json columns as bare JSON *string* values, not the paragraph-doc shape every reader
> expects.

The migration was reverted within the hour. It was correctly re-applied the next day
(`20260827000001_rich_content_json`), in the same deploy as the application code that reads and
writes the new shape — its own comment says so explicitly: "the ordering mistake the revert
exists to explain is not being repeated."

This is not a finding about SQL quality. Both migrations are careful and defensive: each checks
production row counts and shapes before writing the transform, both are tenant-aware under row-
level security (`set_config('app.tenant_id', ...)` per tenant before each UPDATE, so the RLS
policy does not silently zero out the backfill). The gap is entirely about deployment
sequencing — nothing said in writing that the destructive half of a schema change has to wait.

## Decision

Any migration that would make an existing reader or writer of the current schema shape fail —
dropping a column, renaming a column, narrowing a type, or adding a `NOT NULL` constraint with
no default that existing writes do not already satisfy — is split into two migrations:

1. **Expand.** Add the new column/table. Backfill it from the old shape. Ship this whenever is
   convenient; nothing yet depends on the old shape going away.
2. **Contract.** Drop the old column/table. Ships no earlier than the same deploy as the
   application code that has fully stopped reading and writing the old shape.

A single migration may do both only when nothing currently deployed reads or writes the column
being removed — for instance, a column added and removed within the same, still-undeployed
feature branch. Once a migration has run against production, its old shape is a live dependency
until the deploy that stops using it, whether or not the migration and the code change went out
together.

## Alternatives rejected

- **A migration linter or CI check enforcing this mechanically.** Worth doing, but it is a
  second, separable piece of work — a check needs to know what "currently deployed" means, which
  this repository does not yet track anywhere machine-readable. Recording the rule in writing
  first does not block adding enforcement later.
- **Leaving it as an unwritten convention the redo migration already followed.** The redo
  (`20260827000001`) got this right, and its own comment already states the rule in prose — but
  a rule stated once, in one migration's comment, is not a rule the next person writing a
  migration is likely to find. Writing it here makes it discoverable independent of which
  migration happens to explain it.
- **Rewriting the historical migrations to look like they always followed this pattern.** The
  revert-then-redo sequence is itself the useful record — it is the evidence this ADR cites.
  Editing it away would remove the only concrete illustration of what goes wrong.

## Consequences

- A destructive schema change now always costs two migrations and two deploys where it might
  have been one — slower, deliberately, for the class of change that broke production the one
  time it wasn't.
- Nothing about this changes migrations that are purely additive (a new column, a new table, a
  new index) — those still ship whenever ready, same as today.
- The historical migrations this ADR cites are left exactly as they are; this is a rule for
  migrations written from here forward.

## Principles checked

Tenant isolation at both layers: unaffected — this ADR is about deploy sequencing, not about how
any single migration handles tenancy (both cited migrations already set `app.tenant_id` per
tenant correctly). Pure reducer, attribution as a parameter, derived values never stored: none
apply; this ADR does not touch the reducer or the write path.
