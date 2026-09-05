/**
 * Pure guards for scripts/backfill-project-members.ts. No I/O, no clock, so they can be proved
 * alone before the script that uses them is run against anything real.
 *
 * Why this exists: on 2026-09-05 a dry run against production reported it "would create" six
 * rows for people who already held live membership rows. The script numbers rows from an
 * iteration counter and upserts by that id, so a --commit re-run would have rewritten six
 * existing rows to different people. Recorded as ART-20260905-013 (correction) and ADR 0004;
 * the full fix moves planning here and writing through the reducer. Until that lands, the one
 * rule below is the interim control the correction's acceptance criteria name: --commit is
 * refused the moment any membership row exists, live or removed.
 */

/**
 * The refusal message for a --commit run, or null when the run may proceed.
 * A dry run is never refused: it writes nothing and is how the report is read.
 */
export function commitRefusal(existingMembershipRows: number, commit: boolean): string | null {
  if (!commit) return null
  if (existingMembershipRows <= 0) return null
  return (
    `Refusing --commit: this workspace already has ${existingMembershipRows} ProjectMember row(s). ` +
    'The backfill upserts by an iteration-ordered id and would overwrite existing rows for different people ' +
    '(ART-20260905-013). Add members through the Members panel, or wait for the correction that routes ' +
    'this script through the reducer. Nothing was written.'
  )
}
