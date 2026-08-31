---
name: axiomate-design-audit
description: This skill should be used when auditing Axiomate TMS for design-system drift — token inconsistencies, orphaned CSS, stale documentation, or patterns that have quietly diverged from the standard. Use when the user asks for a UI/design audit, a consistency check, or before a larger refactor to know what's actually drifted versus what's fine as-is.
---

# Axiomate Design Audit

Formalizes the exact process that found and fixed two real inconsistencies today (the
Configuration nav mismatch, commit `47239f1`; the padding/motion gaps found by UI/UX review,
commit `adc8645`). Read-only by default — an audit reports findings, it doesn't fix them,
unless the user has explicitly asked for both.

## Process

Follow `references/audit-template.md` — a repeatable checklist covering:

1. Token usage — grep for raw hex/px values that should be tokens, per
   `docs/design/axiomate-design-system.md`'s scales.
2. Two-idiom drift — a pattern class (nav, card, status) implemented two different ways in two
   places that should look like one thing (the Configuration-rail-vs-sidebar bug's shape).
3. Reduced-motion coverage — every `animation`/`transition` on a mount/entrance has a guard,
   using the house style (override-to-none).
4. Touch-target coverage — every control on a touch-primary surface (currently `/my-week`) is
   ≥44px.
5. Color-not-only — every status indicator pairs color with a non-color signal.
6. Documentation freshness — does `docs/design/screen-inventory.md` still match
   `AppSidebar.tsx`'s actual groups/views and `ConfigWorkspace.tsx`'s actual section list?

## Output

A findings report, worst-first, each with a file:line reference and — per the pattern
established by prior reviews in this project — an explicit call on whether it's a genuine
defect or an intentional exception (dense-grid spacing, desktop-only surfaces are NOT defects;
don't flag density itself). Do not propose fixes inline unless asked; report, then let the user
decide priority, matching how the ui-ux-pro-max review and the layout audits in this project's
history were handled.

## Full reference

`references/audit-template.md` — the checklist in checkable form, plus the specific known-gap
list to verify isn't regressed (`axiomate-ux-review`'s `ux-checklist.md` has the same list —
keep both in sync).
