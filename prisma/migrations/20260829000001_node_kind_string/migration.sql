-- HierarchyNode.kind: enum -> text.
--
-- The tier chain above Project became per-organisation configuration (E0 Step 2), so the set
-- of tier kinds is open and a closed database enum can no longer hold it. After this, a new
-- tier is data, not DDL.
--
-- Pure DDL, no DML, deliberately: the stored values stay the uppercase enum labels
-- ('COMPANY' ... 'MODULE') byte-for-byte, because the previous release is still serving while
-- this applies and it reads and writes exactly those spellings. lib/db/map.ts keeps the
-- case mapping for the five default kinds and passes anything else through unchanged — an
-- org-defined tier is stored as its kind string as-is. Rewriting the values to lowercase was
-- rejected for exactly the window it would break; if that normalisation is ever wanted it is
-- its own two-release change.
ALTER TABLE "HierarchyNode" ALTER COLUMN "kind" TYPE TEXT USING "kind"::text;

DROP TYPE "NodeKind";
