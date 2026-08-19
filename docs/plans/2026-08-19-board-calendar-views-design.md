# Board and Calendar views — design

Approved 19 August 2026. Phase 1 of the Hive gap program (quick wins first, by decision of the
operator on the same day).

## What is being built

Two additional presentations of the workspace — a status board and a month calendar — beside the
existing tree-and-Gantt. Presentations only: no new entity, no new action kind, no migration.
Everything both views show is computed from the same filtered state the tree renders, and every
mutation they offer dispatches an action that already exists.

## The view switcher

A `Tree | Board | Calendar` control in the toolbar. The Day/Week/Month/Quarter buttons are Gantt
zoom and remain Gantt-only; they hide when the Gantt does. Tree stays the default. The choice
persists per user alongside column preferences. Client, work type, discipline, status and
schedule-health filters apply to every view identically — a filter is a statement about the
register, not about one rendering of it.

## Board

Lanes are the workspace's statuses **from configuration** — `ISSUE_STATUSES` as the tenant has
them, in transition-graph order, with a live count per lane. Cards carry ID, title, severity,
owner and due date, and open the same detail panel the grid opens.

The rule that makes this safe: **a drag is the same lever as the grid's status editor.**
Dropping a card dispatches the ordinary `updateIssue`; the reducer's transition graph decides.
An illegal move snaps the card back and names the refusal in the policy's own words. A drop onto
a closing status that requires a reason or evidence opens the same dialog `IssueFocus` uses —
the board must never become a way to close work with less ceremony than the form.

Deliberately absent: WIP limits, per-lane scores, swim-lane colour coding by health. Nothing on
a lane is a number somebody argued about; counts only.

## Calendar

A month grid placing issues by planned end date, spanning start-to-end where both exist. The
honesty requirement is the whole design: **124 of 247 issues carry no planned date today**, and
a calendar that quietly renders half the register would be the clipped-summary fault in a new
costume. So an "Unscheduled" rail sits beside the grid carrying the count and the list, and the
header sentence states the split — what the calendar shows, and how much it cannot. Clicking a
day narrows to that day's issues; clicking an issue opens the detail panel. No mutation happens
on this view in v1 — dragging to reschedule is a later decision, not an omission.

## Error handling

A refused board drop is not an error state: the card returns, the refusal renders where the
lane header is, and it uses `statusPolicy`'s own message. There is nothing else that can fail —
both views are pure functions of state already in the page.

## Testing

Two new scenarios: (1) an illegal board transition is refused with the policy's words, driven
through the reducer exactly as the drop handler drives it; (2) the calendar's scheduled +
unscheduled counts reconcile with the register total under every filter. Then the browser
checklist gains sections 15 (Board) and 16 (Calendar) and both are clicked in production.
