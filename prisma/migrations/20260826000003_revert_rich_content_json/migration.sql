-- Emergency revert of 20260826000002_rich_content_json.
--
-- That migration landed on the live production database while the deployed app
-- (axiomate-tms.azurewebsites.net, same database) was still the pre-rich-content build,
-- which reads/writes Issue.description and IssueNote.body as plain strings. Two live
-- risks followed immediately: the deployed Overview tab would throw trying to render a
-- JSON object as a React child, and the intake mailbox watcher (polls every 3 minutes)
-- would write plain strings into the new Json columns as bare JSON *string* values, not
-- the paragraph-doc shape every reader expects -- a third, wrong data shape accruing
-- live. Verified directly before reverting: 0 rows existed in that wrong shape yet, so
-- this reverts a clean, fully-doc-shaped data set, not a mixed one.
--
-- This is a genuine content transform in reverse, matching Step 2's migration's own
-- shape exactly: every row today is `{"type":"doc","content":[{"type":"paragraph",
-- "content": []}]}` or `{"type":"doc","content":[{"type":"paragraph","content":
-- [{"type":"text","text":"..."}]}]}` -- Step 2's migration and lib/richText.ts's
-- wrapPlainText/emptyRichDoc are the only things that have ever written to these columns
-- since the schema became Json, so extracting the first paragraph's first text node
-- (COALESCE to '' when the content array is empty) recovers the original string exactly.
--
-- Same FORCE ROW LEVEL SECURITY consideration as the forward migration: the UPDATE is
-- DML and needs app.tenant_id set per tenant before it can see any rows to update.
--
-- The rich-content plan (docs/plans/2026-08-26-rich-content-plan.md) resumes from here:
-- Steps 3-5 will be finished with the application code, and this migration re-applied
-- (as a fresh forward migration, not by resurrecting this one) in the same deploy as the
-- code that reads/writes the new shape -- not separately again.

-- AlterTable: Issue
ALTER TABLE "Issue" ADD COLUMN "description_old" TEXT;

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM "Tenant" LOOP
    PERFORM set_config('app.tenant_id', t.id, true);
    UPDATE "Issue" SET "description_old" =
      COALESCE(description->'content'->0->'content'->0->>'text', '')
    WHERE "tenantId" = t.id;
  END LOOP;
END $$;

ALTER TABLE "Issue" DROP COLUMN "description";
ALTER TABLE "Issue" RENAME COLUMN "description_old" TO "description";
ALTER TABLE "Issue" ALTER COLUMN "description" SET NOT NULL;

-- AlterTable: IssueNote
ALTER TABLE "IssueNote" ADD COLUMN "body_old" TEXT;

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM "Tenant" LOOP
    PERFORM set_config('app.tenant_id', t.id, true);
    UPDATE "IssueNote" SET "body_old" =
      COALESCE(body->'content'->0->'content'->0->>'text', '')
    WHERE "tenantId" = t.id;
  END LOOP;
END $$;

ALTER TABLE "IssueNote" DROP COLUMN "body";
ALTER TABLE "IssueNote" RENAME COLUMN "body_old" TO "body";
ALTER TABLE "IssueNote" ALTER COLUMN "body" SET NOT NULL;
