-- I7 (docs/pending-actions.md): a firm's own fields on an Issue, the minimal cut of Hive's
-- Custom fields (Select/Text/Date/Number, no Formula/Table lookup). The catalogue itself lives
-- in OperatingModel's existing Json column; this is the value a person types against it on a
-- real issue. Additive, no DML.

ALTER TABLE "Issue" ADD COLUMN "customFields" JSONB NOT NULL DEFAULT '{}';
