-- Re-applies 20260826000002_rich_content_json's content transform as a fresh forward
-- migration, per that migration's own revert (20260826000003_revert_rich_content_json)
-- explicitly saying to do it this way rather than by resurrecting the old file.
--
-- The first attempt landed on production while the deployed app was still the
-- pre-rich-content build and was reverted within the hour. This time the schema and the
-- deployed application code (Issue.description/IssueNote.body as Json throughout, no
-- plain-text bridge, actionShape.ts's richDoc check on addNote.body and
-- updateIssue.patch.description, the reducer's own wrapPlainText() on every create's
-- draft.description) have been live together since the last deploy today — the ordering
-- mistake the revert exists to explain is not being repeated.
--
-- Checked directly against production before writing this, same as the first attempt:
-- 260 Issue rows and 50 IssueNote rows across all four tenants (proof-rls-a,
-- proof-rls-b, proof-persistence, axiocloud), 4 empty descriptions, 0 empty note
-- bodies, and zero values anywhere that look already-JSON-shaped (a leading '{') — every
-- existing value is still safely wrappable plain text.
--
-- Same content-transform shape as the first attempt, not a bare type change:
-- `ALTER COLUMN ... TYPE jsonb USING to_jsonb(description)` would wrap the raw string as
-- a JSON *string* value, not the paragraph-doc structure every reader expects. An
-- originally-empty string becomes a paragraph with an EMPTY content array, matching
-- lib/richText.ts's emptyRichDoc()/wrapPlainText('').
--
-- Both "Issue" and "IssueNote" have FORCE ROW LEVEL SECURITY: the UPDATE below is DML,
-- so app.tenant_id must be set per tenant before each tenant's slice runs, or the UPDATE
-- silently matches zero rows tenant-wide and the later SET NOT NULL would only catch
-- that after the DROP COLUMN had already discarded the real data.

-- AlterTable: Issue
ALTER TABLE "Issue" ADD COLUMN "description_new" JSONB;

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM "Tenant" LOOP
    PERFORM set_config('app.tenant_id', t.id, true);
    UPDATE "Issue" SET "description_new" = jsonb_build_object(
      'type', 'doc',
      'content', jsonb_build_array(
        jsonb_build_object(
          'type', 'paragraph',
          'content', CASE WHEN description = '' THEN jsonb_build_array()
                     ELSE jsonb_build_array(jsonb_build_object('type', 'text', 'text', description))
                     END
        )
      )
    )
    WHERE "tenantId" = t.id;
  END LOOP;
END $$;

ALTER TABLE "Issue" DROP COLUMN "description";
ALTER TABLE "Issue" RENAME COLUMN "description_new" TO "description";
ALTER TABLE "Issue" ALTER COLUMN "description" SET NOT NULL;

-- AlterTable: IssueNote
ALTER TABLE "IssueNote" ADD COLUMN "body_new" JSONB;

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM "Tenant" LOOP
    PERFORM set_config('app.tenant_id', t.id, true);
    UPDATE "IssueNote" SET "body_new" = jsonb_build_object(
      'type', 'doc',
      'content', jsonb_build_array(
        jsonb_build_object(
          'type', 'paragraph',
          'content', CASE WHEN body = '' THEN jsonb_build_array()
                     ELSE jsonb_build_array(jsonb_build_object('type', 'text', 'text', body))
                     END
        )
      )
    )
    WHERE "tenantId" = t.id;
  END LOOP;
END $$;

ALTER TABLE "IssueNote" DROP COLUMN "body";
ALTER TABLE "IssueNote" RENAME COLUMN "body_new" TO "body";
ALTER TABLE "IssueNote" ALTER COLUMN "body" SET NOT NULL;
