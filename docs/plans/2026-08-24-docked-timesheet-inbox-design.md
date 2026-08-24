# Dock Timesheet and Notifications as views — design

## What this answers

The first slice of "Personal Workspace consolidation" from the BOS reference document. The
initial framing ("unify My Work, Timesheet and Notifications into one home surface, add a real
Calendar view") turned out to be over-scoped once the actual code was read: `MyWorkPanel` is
already a first-class docked view with a smart landing-page default, and `CalendarView` already
exists (a work-item schedule, not a personal one — that's the second slice, a separate design).
What's actually missing is narrow: `TimesheetPanel` and `Inbox` exist and work, but are reachable
only as a modal and a dropdown, never as a navigable pane the way My Work is.

## What this is

`WORKSPACE_VIEWS` (`lib/viewChoice.ts:11`) gains two entries: `'timesheet'` and `'inbox'`, joining
`mywork | tree | board | calendar | portfolio`. `TimesheetPanel` and `Inbox` each gain a `docked`
prop, following the shape `MyWorkPanel` already established (`components/MyWorkPanel.tsx:36`,
confirmed as the sole live call site — `docked` has no other caller today, so this is extending a
proven pattern to its second and third use, not inventing one): no scrim, no focus trap, no Close
button. The view switcher is how you leave, same as My Work.

No new data model. No new screens. Both panels already render their full content; this changes
how they're reached, nothing about what they show.

## What this deliberately is not

**Not a replacement for the existing entry points.** The toolbar "Timesheets" button (with its
approval-queue count badge, `FilterBar.tsx:374`) and the bell icon (`Inbox.tsx`'s self-contained
`open` state and unread badge) keep working exactly as today — a modal and a dropdown for a
quick glance without leaving whatever view is open. The new view-switcher entries are a *second*
way to reach the same content full-pane, not a moved door. Clicking the toolbar button still opens
the modal; it does not navigate to the `timesheet` view.

**A real reframing, named rather than left implicit.** The toolbar Timesheets button today is
built around the *approval queue* — its badge counts submissions waiting on the viewer's decision,
and only shows for people who hold `time.approve`. `TimesheetPanel` already does more than that
(anyone can view and submit their own week through it), so docking it as a view reframes it from
"an approval tool" to "my timesheet home" for everyone. This is a widening: nobody loses anything
the modal already gave them, and an approver keeps their queue badge on the toolbar button exactly
as before.

## Verification

This is UI wiring over already-correct business logic — no new reducer arms, no new permission
checks, nothing the scenario harness's proof style (drive the reducer, assert an outcome) applies
to. The checks that fit: `npx tsc --noEmit`, `npm run audit:a11y` (both panels already pass it in
their existing modal/dropdown form; `docked` is a rendering-mode change to markup that already
exists, not new interactive surface), and an honest statement that a live browser drive is not
possible from this session, the same limitation named at the end of the project-membership build.

## What would send this back

- If `TimesheetPanel` or `Inbox` turn out to depend on being mounted/unmounted by their modal
  open-state in a way `docked` mode breaks (a `useEffect` keyed on an open transition, a focus
  trap that assumes it owns the whole screen) — `MyWorkPanel`'s existing `docked` prop is the
  precedent this assumes still applies; if either panel's internals fight that shape, that's a
  finding to fix in the panel, not a reason to build a third pattern.
