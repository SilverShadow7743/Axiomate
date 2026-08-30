# Saved views — the team's views, not the browser's

**Status: approved 2026-08-31** (one AskUserQuestion; small enough to carry its own plan).
Second item of the Hive steal-list. Hive's tabs are per-browser state that dies with the
profile; these are workspace records — named, team-visible, creator-stamped, audited — which
is the level-up the comparison called for.

## The record and its home

`SavedView { id: 'view-<seq>', name, filters: FilterState, view: WorkspaceView, createdBy,
createdAt }`, stored as `model.savedViews: SavedView[]` with the explicit fail-closed merge
every model key gets (stored ?? []; each stored view's `filters` re-parsed with unknown keys
dropped and missing keys defaulted, so a FilterState that has since grown fields loads
harmlessly). No migration — the model rides wholesale.

## The write path — the `setNotificationPref` precedent

Two top-level actions, `upsertSavedView { view }` and `deleteSavedView { id }` — the second
and third non-config arms that write the model, persisted by adding two case labels to the
EXISTING operatingModel-upsert block in persistSteps, with persistence-proof coverage in the
same commit (the recorded new-arm trap, respected). Gate `work.edit` in the permission table
(the seven delivery roles hold it; client seats do not), and the ARM enforces ownership:
only the creator or a `config.manage` holder updates or deletes another person's view. Name
required and trimmed; both writes audited (rowId `VIEWS`, field `savedView`).

## UI

A "Views ▾" toolbar control: the saved list (name · creator), click applies `filters` + the
tab in one client-side set; "Save current view…" captures the live FilterState + view under
a typed name; a delete affordance only where the reducer would allow it (the reducer still
refuses regardless — the button is a courtesy, not the gate).

## Pinned by SV1 (suite 189 → 190)

Save through the reducer → stored with creator + audit line; junk filters in a stored view
parse fail-closed; an empty name refuses; a second actor's update/delete refuses without
`config.manage` and succeeds with it; delete removes. Apply is pure client state — nothing
to drive server-side.

## Non-goals

Personal-only views, ordering, per-view sharing controls, pinning.

## What would send this back

- FilterState churning often enough that saved views rot despite the fail-closed parse —
  they would need versioned parsing. Surfaces in use.
- Teams wanting private views — the personal-vs-shared split returns as a real requirement
  rather than a guessed default. Surfaces in use.
