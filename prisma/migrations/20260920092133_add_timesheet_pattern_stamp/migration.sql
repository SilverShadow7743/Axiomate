-- docs/plans/2026-09-20-timesheet-approval-pattern-stamp-design.md: a Stamped<{hoursPerDay,
-- daysPerWeek}> (lib/versioning.ts), frozen at approval so a later correction to a working
-- pattern cannot retroactively move an already-approved week's figures. Additive, nullable, no
-- backfill -- every existing timesheet starts at null, an honest "predates the stamp," not a
-- gap to fix.

ALTER TABLE "Timesheet" ADD COLUMN "workingPatternStamp" JSONB;
