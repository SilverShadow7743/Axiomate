-- The five complexity dimensions move from "1-5, 0 means not scored yet" to "0-5, 0 is a real
-- score, NULL means not scored yet" -- see docs/plans/2026-08-26-estimation-zero-to-five-design.md.
--
-- The ALTER runs before the UPDATE on purpose: the columns are NOT NULL today, so an UPDATE
-- setting them to NULL would be rejected by the still-active constraint if it ran first.
--
-- AlterTable
ALTER TABLE "IssueEstimate" ALTER COLUMN "business" DROP NOT NULL,
ALTER COLUMN "business" DROP DEFAULT,
ALTER COLUMN "technical" DROP NOT NULL,
ALTER COLUMN "technical" DROP DEFAULT,
ALTER COLUMN "integration" DROP NOT NULL,
ALTER COLUMN "integration" DROP DEFAULT,
ALTER COLUMN "testing" DROP NOT NULL,
ALTER COLUMN "testing" DROP DEFAULT,
ALTER COLUMN "data" DROP NOT NULL,
ALTER COLUMN "data" DROP DEFAULT;

-- Every existing 0 has only ever meant "not scored yet" under the old schema: no write path
-- could previously store a deliberate 0 (the UI only ever wrote 1-5, and the auto-estimator
-- floored every touched parameter to a minimum of 1). Left as 0, these would be silently
-- reinterpreted as a deliberate "None" score under the new meaning. Checked directly against
-- production before writing this migration: 112 IssueEstimate rows across every tenant, zero
-- of them carry a 0 in any of these five columns today -- so this has nothing to do right now,
-- and is here so the migration is correct on its own terms, not because a test caught something.
UPDATE "IssueEstimate" SET "business" = NULL WHERE "business" = 0;
UPDATE "IssueEstimate" SET "technical" = NULL WHERE "technical" = 0;
UPDATE "IssueEstimate" SET "integration" = NULL WHERE "integration" = 0;
UPDATE "IssueEstimate" SET "testing" = NULL WHERE "testing" = 0;
UPDATE "IssueEstimate" SET "data" = NULL WHERE "data" = 0;
