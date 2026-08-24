# Project membership — design

## The question this answers

The BOS reference document put four words at the top of its hierarchy that this app cannot
currently answer: **what projects can they access?** Today it can't ask the question. Every
internal person who holds `internal.view` sees the entire tree — every client, every engagement,
every project, in one flat pool. Access is granted per capability (`work.create`, `time.approve`,
`config.manage`, …) and nowhere else; it has no notion of *which* work a grant applies to.

This design adds that notion, for the unit the app already treats as commercially real: the
`'project'` hierarchy node. `attributeToSow` already refuses to attach a statement of work to
anything else — "work is attributed by project, so the statement of work goes on the project"
(`lib/workspace.ts:5330`) — and `Allocation.projectId` already commits capacity to one. Project
membership is the third fact keyed to the same unit: who may see and act on it at all.

## What this is

- A new record, `ProjectMember`, naming a person, a project node, a descriptive project role, and
  a tenure (`addedAt` / `removedAt`).
- A **read gate**: an internal person who isn't a member of a project (and isn't exempt) does not
  see it — not the tree under it, not its issues, not its time entries. This is the literal answer
  to "what can they access", and it is why this is a bigger change than a permission tweak: it
  narrows what `boot()` puts in the page payload for people whose access is unrestricted today.
- A **write gate**: the reducer refuses an action against a record under a project the actor isn't
  a member of, even if their role would otherwise permit the action anywhere.
- A **label**: the project role recorded on each membership (Sponsor, PM, Architect, Consultant,
  …) is descriptive — it drives what a person's badge says on the Members screen and what "my
  projects" reports by, and nothing else yet. See the next section.

## What this deliberately is not

**Not a second permission-authority axis.** A person's global role (`Person.roleIds`) still
decides *what* they may do, unchanged, everywhere — `DEFAULT_GRANTS` is untouched. Membership
decides *where*. A PM is a PM's worth of capability on every project they're a member of; they are
not a Consultant on one and a PM on another by virtue of a different project-role label. If that
distinction turns out to matter in practice — a firm that genuinely wants a person's authority,
not just their assignment, to differ by engagement — that is a second grants table
(`projectRole → PermissionKey[]`) and a much larger design, deliberately deferred rather than
built speculatively. `ProjectRole` today carries no grants, the same way `maxAutonomy` on an agent
carries no runtime until one is built — declared and inert is an honest state; declared and
*silently* enforced would not be.

**Not per-project workflow or work-item taxonomy.** `ALLOWED_PARENTS`, `statusPolicy.transitions`,
and the work-item type registry stay global. Two projects under this design still share one
taxonomy and one workflow. That is the BOS document's §11 C/D, and it's a materially different,
separable piece of work (the tree's parent/child rules are a single hardcoded table today, not a
per-scope override) — not attempted here.

**Not multi-organization.** The tenant already is the organisation boundary (`currentTenantId()`,
every table scoped to it). This design adds a layer *inside* one tenant, not another layer above
it.

**Not a replacement for `clientScopeId`.** The client boundary (`lib/clientBoundary.ts`) governs
what a *client-role* person sees — scoped to a `'client'` node, redacting to marked-visible content
only. Project membership governs what an *internal* person sees — scoped to `'project'` nodes,
redacting nothing (an internal member of a project sees everything under it, same as today). The
two run side by side and never interact: a client contact's view is decided entirely by
`clientScopeId`; an internal consultant's view is decided entirely by project membership. Nobody
is both.

**Not every record.** Some work sits directly under a bare `'client'` or `'engagement'` node with
no `'project'` ancestor — `ALLOWED_PARENTS` has always permitted that, and plenty of real work
(internal build issues, engagement-level administration) is organised this way today. A record
with no `'project'` ancestor is not gated by membership at all; visibility for it stays exactly
what it is today, governed by `internal.view` alone. This is a deliberate boundary, not an
oversight — it means adopting project membership is opt-in at the granularity a firm already
controls (whether they bother creating a `'project'` node for a piece of work), and nothing
currently ungated becomes newly invisible by accident.

## Data model

```ts
export interface ProjectMember {
  id: string
  /** The project node. Same unit as Allocation.projectId and a SOW's node attribution. */
  projectId: string
  /** Display name, for the same reason Allocation carries one: the log this grew from names
   *  people, not ids. */
  person: string
  /** Resolved directory id, when the name resolves uniquely. */
  personId?: string | null
  /** Descriptive only — see "what this is not" above. */
  projectRoleId: string
  addedBy: string
  addedAt: string
  /** Soft-ended, not destroyed: a person's history of who was staffed where is itself a fact
   *  worth keeping, the same reason Allocation and Commitment never hard-delete. */
  removedAt: string | null
}
```

Shaped deliberately like `Allocation` (`lib/capacity.ts:219`), because it answers a sibling
question about the same node — capacity asks "how much of this person's time", membership asks
"may this person be here at all" — and keeping the two records structurally alike is what makes
the backfill migration able to read one to seed the other (see below).

`ProjectRole` joins the operating model as its own registry, alongside the existing `roles:
Record<string, OrgRole>`:

```ts
projectRoles: Record<string, ProjectRole>   // { id, label, description, seeded, deletedAt }
```

Seeded with the BOS document's own list — Sponsor, Project Manager, Engagement Manager, Solution
Architect, Technical Architect, Functional Lead, Technical Lead, Consultant, Developer, Tester,
Reviewer, Customer, Stakeholder — configurable and relabel-able the same way `OrgRole` is, through
`ConfigWorkspace`. Kept as a separate registry from `roles` rather than reusing it, because the two
answer different questions (capability vs. assignment) and a firm renaming "Consultant" the org
role should not silently relabel "Consultant" the project badge.

## The gate

### Resolving which project a record belongs to

`scopeChainOf(state, id)` already exists and already walks a record's full ancestor chain, fine to
coarse (`lib/workspace.ts:696`) — it's what config-scope resolution and the SOW-engagement check
both use today. The gate reuses it as-is:

```ts
function projectOf(state: WorkspaceState, recordId: string): string | null {
  for (const scopeId of scopeChainOf(state, recordId)) {
    if (state.nodes[scopeId]?.kind === 'project') return scopeId
  }
  return null
}
```

### The check itself

`can()` (`lib/access.ts:365`) is unchanged — it still answers "does this actor's role permit this
capability at all", takes only `model`, and every existing caller that asks that abstract question
(button enablement, a screen deciding whether to show a control) keeps calling it exactly as
today. A new wrapper sits beside it for the ~dozen reducer arms and record-scoped screens that act
on one specific record:

```ts
export function canOnProject(
  state: WorkspaceState,
  actor: Actor,
  key: PermissionKey,
  recordId: string,
): Decision {
  const base = can(state.model, actor, key)
  if (!base.allowed) return base

  const projectId = projectOf(state, recordId)
  if (!projectId) return base                              // no project ancestor: ungated, as today
  if (isExempt(state.model, actor)) return base             // ADMIN, machine actor

  const member = Object.values(state.projectMembers).some(
    (m) => m.projectId === projectId && !m.removedAt &&
      (m.personId === directoryPersonFor(state.model, actor)?.id),
  )
  return member
    ? base
    : { allowed: false, reason: `${actor.name} is not staffed on this project.` }
}
```

This is deliberately a *wrapper*, not a change to `can()`'s signature. Rewriting every one of the
existing call sites to thread a record id through was the size of change flagged as the risk
earlier in this conversation; resolving `can()` first and narrowing only at the record-scoped call
sites means the ~50 existing calls are untouched, and only the reducer arms that mutate a specific
record (and the detail-panel actions that mirror them) move to the new function. `permissionForAction`
stays the single source of which key an action needs; `canOnProject` is which record it needs it
on.

**Exemption.** `ADMIN_ROLE_ID` and `MACHINE_ROLE_ID` bypass the gate entirely — an administrator
sees and can act on every project by design (the same reasoning `defaultRoleIds` ships as
Administrator: a deployment needs an operator who is never locked out of their own configuration),
and the intake watcher / scheduled pass act on behalf of rules that span the whole tree, not a
staffed human.

**Known limitation, not solved here.** An `ROLE_ENGAGEMENT_LEAD` who genuinely oversees every
project under one engagement gets no automatic visibility across them — they need a membership row
per project, same as anyone else. Adding an engagement-level exemption is a second scope tier on
top of this one; left alone until real usage shows it's actually painful, rather than built against
a guess.

### The read side

Write-gating alone does not answer "what projects can they access" — it answers "what can they
*change*". An internal person who isn't a member of a project would still see its entire tree,
issues, notes and time entries under today's `internal.view`-is-binary model, which is not what the
BOS document is asking for and not an honest reading of "access."

So `redactForReader` (`lib/db/boot.ts:250`) gains a second narrowing, run for internal readers the
same way `clientView` runs for client-scoped ones:

```ts
if (can(state.model, actor, 'internal.view').allowed) {
  return isExempt(state.model, actor) ? base : projectView(base, memberProjectIdsFor(state, actor))
}
return clientView(base, ...)
```

`projectView` keeps: every record whose `projectOf(...)` is in the actor's member set, every record
with **no** project ancestor (ungated, per "what this is not" above), the ancestor chain of
anything surviving (a record without its place is unreadable — the same rule `clientView` already
states), and activities/relationships/audit entries about surviving records. Structurally this is
the same shape as `clientView`, applied along a different axis — project membership instead of
`clientScopeId` — and it is worth building as a genuinely separate function rather than
parameterising `clientView`, because the two redact for different reasons (content marked visible,
vs. work you're staffed on) and a shared function that happens to do both today is the kind of
convenient collapse that breaks the day one of them needs to change alone.

An internal person who is a member of no project sees nothing — deliberately the same shape as the
existing "client seat not attached to a client" case, and it reuses the same UX pattern: `boot()`'s
banner already distinguishes "nothing to show" from "nothing configured"
(`lib/db/boot.ts:169`–`177`); this design adds the parallel sentence — *"Your account isn't staffed
on any project yet — ask your PM to add you."*

## The rollout — this is the part that cannot be gotten wrong

This ships against a live database with real people (a directory of 26+, some with 100% live
allocations) who can see the whole tree right now. Turning on `projectView` with an empty
`projectMembers` table is a lockout of the entire internal staff on deploy day, not a feature.

The migration that adds the `ProjectMember` table runs a backfill in the same transaction, before
any code that reads it ships: for every `'project'` node, enrol every person who has *already
touched it* —

- owns or is assigned to an issue in its subtree (`IssueRecord.owner` / responsibilities),
- has a time entry against it,
- holds a live `Allocation` on it,
- is named on a `Commitment` or SOW-linked record under it,

— with `projectRoleId` chosen from whatever their org role best maps to (PM → Project Manager,
Engagement Lead → Engagement Manager, everything else → Consultant, correctable by hand
afterwards), `addedBy` recording the migration itself, `addedAt` backdated to the earliest evidence
found. Someone who has touched nothing under a project gets nothing — which is correct, not a gap:
it means they can see a project today that they have never once worked on, and the honest
statement of this feature is that this stops.

`ROLE_ADMIN` holders need no backfill row — they're exempt by role, as above.

This backfill is graded on one thing: **nobody who is actively working a project loses sight of it
on deploy day.** The verification for this step is not "the migration runs without error" — it's a
before/after comparison, per person, of what they could see against what the backfilled membership
now permits, run against the real production data before the migration is applied for real.

## What's out of scope, on purpose

- Per-project work-item taxonomy / workflow (§11 C/D of the reference document) — needs the tree's
  parent/child rules and `statusPolicy` to become scope-resolved the way labels already are; a
  separate design once membership exists to hang it off.
- Project role as a second grants table — deferred above.
- Cross-project resource-allocation views, utilisation reporting — reads `Allocation` and now
  `ProjectMember` together; worth doing once both exist, not blocking this.
- Organization / Administration navigation restructuring from the reference document (§7, §20) —
  the tenant already is the organisation; there is no multi-org container to build.

## Constraints carried forward from the rest of this program

- The reducer stays the single mutation funnel: `addProjectMember` / `removeProjectMember` /
  `updateProjectMember` (role correction) are new `Action` arms, not a side door.
- Every membership change is attributed and audited (`addedBy`, and an audit row on add/remove),
  same as every other mutation in this app.
- The migration is additive and applied to production *before* the code that reads
  `state.projectMembers` deploys — the established order for every schema change this session.
- `ProjectMember` needs the same five-point wiring every new collection has needed throughout this
  program: `WorkspaceState` field, Prisma model + migration, `map.ts` `fromRow`/`toRow`, `repo.ts`
  `Reader` type + query, `persist.ts` write case, plus `actionShape.ts` SHAPES and `access.ts`
  `ACTION_PERMISSIONS` for the three new actions, and the workspace route's `KINDS` set. Naming
  this now so the plan doesn't have to rediscover it.

## What would send this back

- If the backfill's before/after comparison shows real people losing sight of work they are
  actively on, on real production data — the backfill heuristic is wrong and needs revisiting
  before anything ships, not a known gap to patch after.
- If `scopeChainOf` turns out not to reliably terminate at a `'project'` node for a meaningful
  share of real records (i.e. most work in practice sits directly under `'client'`/`'engagement'`
  with no project node) — the gate would then cover almost nothing, and the premise ("project" is
  the right unit) needs re-examining rather than shipping a control that mostly doesn't apply.
- If `canOnProject` as a wrapper turns out not to cover the record-scoped call sites cleanly (some
  action operates on a record with no clear single project, e.g. a cross-project link or
  dependency) — that's a real design gap in the wrapper's assumption of "one record, one project",
  not an edge case to paper over silently.
