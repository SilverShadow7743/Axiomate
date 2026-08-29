-- TimeEntry gains an optional task reference (E0 step 6).
--
-- Additive, no DML, no backfill: every existing row is attested work-level history and is not
-- touched. issueId stays NOT NULL on every entry including task-level ones — the transitional
-- actuals rule (Work.actual = sum over issueId, unchanged; Task.actual = sum over activityId,
-- new) depends on it, which is why this migration adds a nullable column and nothing else.
ALTER TABLE "TimeEntry" ADD COLUMN "activityId" TEXT;

ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_tenantId_activityId_fkey"
  FOREIGN KEY ("tenantId", "activityId") REFERENCES "IssueActivity"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "TimeEntry_tenantId_activityId_idx" ON "TimeEntry"("tenantId", "activityId");
