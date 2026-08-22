-- The client-waiting pause clock: when the current status was entered, and the calendar
-- days banked while a client held the ball. Additive and defaulted, so code deployed
-- before this migration keeps working against the migrated table.
ALTER TABLE "Issue" ADD COLUMN "statusSince" TIMESTAMP(3);
ALTER TABLE "Issue" ADD COLUMN "pausedDays" INTEGER NOT NULL DEFAULT 0;
