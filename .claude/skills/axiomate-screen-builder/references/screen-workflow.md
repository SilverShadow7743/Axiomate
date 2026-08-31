# Screen Workflow

## Step 1 — Placement decision

Same decision tree as `axiomate-ui-design`'s `screen-template.md` — repeated here as the
authoritative version for this skill (the two should never diverge; if you edit one, edit both):

1. New top-level "place" → workspace view. Sidebar group per
   `docs/design/information-architecture.md`'s grouping logic (Your work / Workspace / Records).
2. Config/admin surface → Configuration section, right group (Operating model / Governance /
   Automation).
3. Phone-first, touch-primary work → standalone route, like `/my-week`. Not a responsive
   collapse of a dense view.
4. About ONE record → the detail drawer pattern, reusing its dirty-check-gated close.
5. None of the above → stop, this is a Principle 10 moment. Reopen the design.

## Step 2 — Concrete wiring

**Workspace view:**
- `components/AppSidebar.tsx`: add to `GROUPS`, `VIEW_LABEL`, `VIEW_TITLE`.
- `components/IssueWorkspace.tsx`: add the view-switch case (`view === 'yourview' ? <YourPanel
  ... /> : ...`).
- Decide: does it pair with the Filters chip (only if it receives a filtered row set — most
  views don't)? Does it pair with the detail drawer (only if row selection makes sense there)?
- If it's detail-drawer-incompatible (like Timesheets/Notifications/Mail), add it to
  `DETAIL_INCOMPATIBLE_VIEWS` in `IssueWorkspace.tsx`.

**Configuration section:**
- `components/ConfigWorkspace.tsx`: add to the sections array with `{ id, label, group }`.
- Build the form using `.cfg-fld` (structured field pattern) — remember the known gap (no
  required-marker/inline-error convention yet); if this section needs validation, this is a
  good moment to define the convention rather than defer it again.

**Standalone route:**
- New file under `app/`, following `/my-week`'s pattern: sign-in redirect mirrored from the
  root page, phone-first form conventions (44px targets, 16px input font).
- Add a sidebar entry linking to it (`<a>`, not a `setView` call — it's a route, not a view).

**Overlay:**
- Reuse `DetailDrawer`'s close-gate pattern if it's record-shaped; reuse `.modal` anatomy
  (header/body/footer) if it's a standard dialog. Check the z-index ladder in
  `docs/design/axiomate-design-system.md` for where the new overlay's layer belongs relative to
  existing ones — don't guess a z-index.

## Step 3 — Gate

Standard project gate (see the project's own CI/build scripts): `npx tsc --noEmit`,
`npm run validate:scenarios` (if the screen touches scenario-tested logic), `npm run
audit:a11y`, `npm run build`.

Design-system-specific checks before calling it done:
- Every color/spacing/radius/type value traces to a token — no raw hex or arbitrary px.
- Every status indicator has a non-color signal.
- CSS changes are scoped to a named selector list in the diff, not a blanket rewrite.
- `docs/design/screen-inventory.md` updated in the same commit.
