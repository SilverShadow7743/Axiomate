import type { OperatingModel } from './config'
import { liveWorkTypes } from './config'

/**
 * The minimal semantics that make a risk a risk and a decision a decision.
 *
 * The one-table rule holds: both ARE issues — same tree, same notes, same audit, same
 * client-boundary flag. What this module adds is the judgement shape: likelihood and
 * impact each 1–5, and EXPOSURE ALWAYS COMPUTED, never stored — a derived value stored as
 * fact is free to disagree with the halves it was computed from, and only one of them is
 * true. Null halves mean "not yet judged", never a default: a risk nobody has judged is a
 * different fact from a low one, the same honesty the daily cap keeps.
 */

export const RAID_SCALE_MAX = 5

/** The two stable ids the shipped types carry. Recognition is by id, never by label. */
export const RISK_TYPE_ID = 'WT_RISK'
export const DECISION_TYPE_ID = 'WT_DECISION'

export type RaidKind = 'risk' | 'decision'

/**
 * What kind of RAID record an issue is, if any — resolved through the LIVE registry so a
 * renamed label keeps its semantics. The issue stores the label; the registry maps it back
 * to the stable id.
 */
export function raidKindOf(model: OperatingModel, typeLabel: string): RaidKind | null {
  const entry = liveWorkTypes(model).find(
    (t) => t.label.trim().toLowerCase() === typeLabel.trim().toLowerCase(),
  )
  if (!entry) return null
  if (entry.id === RISK_TYPE_ID) return 'risk'
  if (entry.id === DECISION_TYPE_ID) return 'decision'
  return null
}

export type ExposureBand = 'Low' | 'Medium' | 'High' | 'Critical'

/**
 * Likelihood × impact, banded. Null in means null out — "not yet judged" propagates
 * rather than being replaced with a number nobody entered.
 */
export function exposure(
  likelihood: number | null | undefined,
  impact: number | null | undefined,
): { score: number; band: ExposureBand } | null {
  if (likelihood == null || impact == null) return null
  const score = likelihood * impact
  const band: ExposureBand =
    score >= 15 ? 'Critical' : score >= 10 ? 'High' : score >= 5 ? 'Medium' : 'Low'
  return { score, band }
}

/** What a stored judgement must be: a whole number 1–5, or null to un-judge. */
export function raidProblem(patch: {
  riskLikelihood?: number | null
  riskImpact?: number | null
}): string | null {
  for (const [name, v] of [
    ['likelihood', patch.riskLikelihood],
    ['impact', patch.riskImpact],
  ] as const) {
    if (v === undefined || v === null) continue
    if (!Number.isInteger(v) || v < 1 || v > RAID_SCALE_MAX) {
      return `A risk's ${name} is a whole number between 1 and ${RAID_SCALE_MAX} — received ${String(v)}. Clear it to say the risk has not been judged yet.`
    }
  }
  return null
}
