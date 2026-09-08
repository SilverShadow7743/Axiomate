# Automation — two more action kinds a rule can already reach for free

**Status: draft, 8 September 2026.** Scoped from live-toggling Hive's Workflows app (briefly
enabled on the shared "FnO Technical Team" workspace with permission, then switched back off —
nothing saved) and reading its real trigger/action pickers, checked against `lib/automation.ts`'s
own header comment, which already named part of this gap before today.

## What Hive's Workflows actually offers, live-checked

Triggers ("When…"): Assignee changes, Button is clicked, Label is added, Action is created,
Message is received, Slack message is sent, Arrives in column, Status changes, Proof approval
status changes, Arrives in project, Action is updated, **On a schedule**, API Request, Email
received, Form is submitted, and several CRM/table events.

Actions ("Then…"): Create/duplicate/archive action, change assignee, change project, label
add/remove/create, update section, add to sprint, create project from template, **update
status**, update urgency, update due date, remove due date, apply action template, create
baseline snapshot, add/remove follower, send email, post to Slack, AI steps, run a snippet,
score action, CRM enroll.

## Two findings, two different sizes

**Finding 1 — a schedule-only trigger, usable with any action.** This is exactly what
`lib/automation.ts`'s own header comment already named as absent: *"What genuinely is not
expressible is a rule bound to nothing but a calendar interval... `runRecurrences` covers that
shape, but only for raising a new issue, not for this module's notify/addNote/setNextAction/
requestApproval actions."* Confirmed against the live product rather than assumed. **This is
the bigger of the two and is NOT scoped here** — a pure calendar trigger has no natural single
issue to act on (unlike every existing `AutomationRule`, which reacts to something that happened
to one issue via `on: EventType`), so it needs its own shape: something closer to a scheduled
digest over a matching set than a per-issue rule. That is a real design question, not a wiring
job, and deserves its own pass rather than being bundled under this one's smaller finding.

**Finding 2 — two RuleActionKinds Axiomate already has the machinery for.** `RuleActionKind` is
`'notify' | 'setNextAction' | 'addNote' | 'requestApproval'` (`lib/automation.ts:74`). Hive's
"update status" and "change assignee" have no equivalent — but `planActions`
(`lib/automation.ts:265`) already shows the exact pattern to add them: `setNextAction` is
already nothing but `{ t: 'updateIssue', patch: { nextAction: fill(...) } }`. `setStatus` and
`setOwner` are the same wrapper around a different patch field:

```ts
case 'setStatus':
  actions.push({ t: 'updateIssue', id: event.subjectId, patch: { status: step.text }, now })
  break
case 'setOwner':
  actions.push({ t: 'updateIssue', id: event.subjectId, patch: { owner: step.text }, now })
  break
```

This is not a new capability — it is the SAME safety property the module's own header comment
already claims for every rule action: *"A rule cannot do anything a person could not... it is
refused by the same code that would refuse the person."* A rule attempting an illegal status
transition is refused by the same transition-graph check a person's click goes through, because
both paths converge on the identical `updateIssue` reducer arm. Nothing new to validate.

## Scope for this pass

Add `setStatus` and `setOwner` to `RuleActionKind`, wire both in `planActions` exactly as
sketched above, and add a UI entry for each in `ConfigWorkspace.tsx`'s Automation screen wherever
`setNextAction` is already offered. No schema change, no new permission — dispatched through the
same `updateIssue` action, gated on `work.edit` like every other automated write already is.

## What stays out, still

The schedule-only trigger (Finding 1) stays flagged, not designed — see above. Everything else
in Hive's action list (sprints, CRM, Slack, project-level changes, snippets, AI steps) has no
Axiomate equivalent to hang off of and isn't proposed.

## What would send this back

If a real use case needs a status or owner change that ISN'T expressible as a plain `updateIssue`
patch (e.g. one requiring a reason the transition graph demands) — `RuleAction.text` has no field
for a reason today, and `setNextAction` never needed one. Surfaces the first time somebody tries
to automate a transition that requires justification.
