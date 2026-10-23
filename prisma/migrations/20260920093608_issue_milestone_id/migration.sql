-- docs/plans/2026-09-20-milestone-issue-attribution-design.md: which milestone an issue's
-- effort counts toward, when the SOW it is attributed to (via its project's sowId) has more
-- than one. No FK -- same convention as InvoiceLineItem.milestoneId: a milestone later
-- renegotiated or withdrawn must not orphan or cascade-delete work with real hours logged
-- against it. Additive, nullable, no backfill.

ALTER TABLE "Issue" ADD COLUMN     "milestoneId" TEXT;
