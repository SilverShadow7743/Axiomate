# A reporting line — design

## What this answers

Checked before designing anything: `Person` (`lib/config.ts:220`) has no manager field at all —
`id`, `name`, `roleIds`, `email`, `clientScopeId`, `grade`, `track`, `developingToward`, `source`,
nothing more. The BOS document's §6.B lists three — Manager, Reporting Manager, Functional
Manager — which reads as more structure than a consultancy needs by default; this design builds
one relationship (who someone reports to) rather than three, on the same reasoning `grade`/`track`
already gave for staying free text: a firm that needs the distinction can ask for it once it
actually matters, rather than the app guessing at an HR model in advance.

This is deliberately **not** "Team" or "Department" as a standing organisational grouping — that
was the other half of the original question, and it was set aside for not having a concrete need
behind it yet, unlike this one.

## What this is

`Person.managerId?: string | null` — the same absent-versus-cleared field shape `clientScopeId`
already has (`undefined` means nothing recorded, `null` means cleared, a value names another
directory person). No new table, no new `WorkspaceState` collection: `Person` lives inside
`OperatingModel`, already reached through the existing `upsertPerson` config op, so this is an
extension of a path that already exists rather than a new one.

**Validated at the reducer**, the single mutation funnel, same as everything else:

- `managerId` must resolve to a real, non-deleted directory person.
- A person cannot manage themselves.
- **No cycle** — walking up from the new manager through *their* manager, and so on, must never
  reach back to the person being edited. A org chart with a loop in it is not an org chart.

**`deletePerson` refuses when people report to them**, the same "reassign them first" shape
`deleteRole` and `deleteProjectRole` already use. `deletePerson` today deletes outright (not a
soft-remove) — leaving dangling `managerId` references behind it silently would be exactly the
kind of "nothing failed, the wrong thing quietly worked" bug this codebase's own history keeps
naming and fixing.

Surfaced on the existing "Roles & people" config card — a "Reports to" select, directory people
only, alongside the fields already edited there (grade, track, roleIds). No new screen.

## What this deliberately is not

**Not Team/Department.** Set aside for the reason above — no concrete need named for it yet, only
the reference document listing it.

**Not wired into approval routing.** The motivating examples named ("approval routing, org
visibility, 1:1 context") — this design builds the *data*, which the second and third already
need on their own; wiring approval decisions to "the requester's manager" would mean a new kind of
`ApprovalRule` decider (today's rules name roles, `deciderRoleIds`) — a real, separate piece of
work with its own design questions (does a manager need the rule's role too, or does the
relationship alone grant it; what happens when nobody is recorded as anyone's manager), not
something to fold in as a two-line addition to this one.

**Not a Personal Workspace screen.** "1:1 context" was one of the motivating examples, but this
app has no "My Profile" screen for a "Reports to" line to live on yet — the BOS document's own
Personal Workspace list named one and it was never built. Adding a whole profile screen to show
one field would be solving a different, larger gap than this design set out to close. The fact is
recorded and visible on the directory today; where else it surfaces is a later question.

**No new visibility rule.** `Person` records are already org-wide visible to any `internal.view`
holder, the same class of fact as `grade`/`track`/`roleIds` — a reporting line needs nothing
stronger.

## What would send this back

- If cycle detection, once written, turns out to need more than a single upward walk to catch
  every case a real directory could produce (a self-referential edit racing another one, say) —
  that's a real gap in "walk up and check," not something to special-case around.
- If `deletePerson`'s new refusal turns out to break an existing, relied-upon deletion flow this
  design didn't anticipate — that's a finding about the existing behaviour, not a reason to skip
  the check.
