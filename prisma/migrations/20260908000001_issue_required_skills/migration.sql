-- I3 (docs/pending-actions.md): what a deliverable requires. candidatesFor (lib/skills.ts) has
-- always been able to answer "who could do this" against a Requirement[]; nothing produced one.
-- This is the field a person types it into. Additive, no DML.

ALTER TABLE "Issue" ADD COLUMN "requiredSkills" JSONB NOT NULL DEFAULT '[]';
