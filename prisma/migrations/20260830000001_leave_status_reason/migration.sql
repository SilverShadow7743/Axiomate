-- Leave approval and its private reason (E1). Additive, and deliberately WITHOUT a backfill:
-- a NULL status means Approved by definition in the domain (every pre-E1 row is history
-- recorded under the old rules), so there is no DML, no RLS tenant loop, and nothing to
-- re-run — the absent-means-approved rule lives in code, in exactly one place
-- (lib/availability.ts's commitmentCounts).
ALTER TABLE "Commitment" ADD COLUMN "status" TEXT;
ALTER TABLE "Commitment" ADD COLUMN "reason" TEXT;
