-- Issue.description and IssueNote.body move from plain text to a Tiptap-shaped JSON
-- document -- see docs/plans/2026-08-26-rich-content-design.md and
-- docs/plans/2026-08-26-rich-content-plan.md's Step 2.
--
-- This is a genuine content transform, not a type-nullability change: `ALTER COLUMN ...
-- TYPE jsonb USING to_jsonb(description)` would wrap the raw string as a JSON *string
-- value*, not the paragraph-doc structure every reader now expects. So this builds the
-- real structure with jsonb_build_object/jsonb_build_array, which handle JSON
-- string-escaping (quotes, newlines, unicode) correctly with no manual escaping to get
-- wrong.
--
-- An originally-empty string becomes a paragraph with an EMPTY content array, never a
-- text node carrying "" -- ProseMirror's schema refuses a zero-length text node, and
-- lib/richText.ts's emptyRichDoc()/wrapPlainText('') already commit to this exact shape.
--
-- Checked directly against production before writing this: 260 Issue rows and 50
-- IssueNote rows across all four tenants (axiocloud, proof-persistence, proof-rls-a,
-- proof-rls-b), 4 empty descriptions, 0 empty note bodies, and zero values anywhere that
-- look already-JSON-shaped (a leading '{') -- every existing value is safely wrappable
-- plain text, so the CASE WHEN below is the only branching this needs.
--
-- Both "Issue" and "IssueNote" have FORCE ROW LEVEL SECURITY (see the
-- row-level-security migration): the UPDATE below is DML, so it is filtered by the
-- tenant_isolation policy exactly like any other UPDATE from this role, even though this
-- role owns the table. Skipping the per-tenant app.tenant_id assignment would make the
-- UPDATE match zero rows tenant-wide -- not an error, just silently no-op -- which the
-- later ALTER COLUMN ... SET NOT NULL would then catch loudly (every "_new" column would
-- still be NULL), but only after the DROP COLUMN had already discarded the real data.
-- The DO block below sets app.tenant_id per tenant before each tenant's slice of the
-- UPDATE runs, the same mechanism lib/db/repo.ts's loadWorkspace/importWorkspace and
-- lib/db/persist.ts's runBatch use at request time.

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
