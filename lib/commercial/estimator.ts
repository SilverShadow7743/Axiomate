import { COMPLEXITY_PARAMETERS, emptyScores, isScored, type ComplexityKey, type ComplexityScores, type Confidence } from './estimation'

/**
 * Reading an issue and proposing how complex it is.
 *
 * Pure — no clock, no I/O, no model. It takes the words somebody wrote and returns five scores
 * plus the reasoning that produced them, and everything downstream (size, hours, working days,
 * finish date) is derived from those scores by `deriveEffort` exactly as it is for a person's.
 * That is the point of scoring the *inputs* rather than writing an hours figure: an agent and a
 * consultant produce the same shape, and the firm's own calibration converts it.
 *
 * ---------------------------------------------------------------------------
 * What this is not
 *
 * It is not an oracle. It matches vocabulary that means something specific in a Dynamics 365
 * finance-and-operations delivery, and vocabulary is a proxy for the work, not the work. A
 * one-line issue saying "costing is wrong" scores as the hardest thing in the product, because
 * in this product it usually is; a three-page issue about a label scores as a label. Both are
 * sometimes wrong.
 *
 * Three things keep that honest rather than dangerous:
 *
 *  1. **An issue it cannot read gets no estimate at all.** `emptyScores()` leaves every
 *     parameter at zero, `isScored()` is false, and `deriveEffort` yields no size and no hours.
 *     The alternative — defaulting the five to 3 — produces a Medium-sized estimate for an issue
 *     nobody has read, which is indistinguishable on screen from one somebody has.
 *  2. **Confidence is always Low.** Not because the reading is poor but because no person has
 *     looked. Confidence is a claim about the estimate, and the only honest claim available from
 *     matching words is a weak one.
 *  3. **The reasoning travels with the number.** `basis` names every rule that fired, so the
 *     consultant correcting it can see what the machine thought it was looking at rather than
 *     arguing with a bare 4.
 *
 * ---------------------------------------------------------------------------
 * Where the numbers come from
 *
 * The five parameters are the ones `COMPLEXITY_PARAMETERS` already defines: business, technical,
 * integration, testing, data. Each rule below states which it moves and why, in terms of what
 * the work actually involves in this product. The scores are deliberately not uniform: inventory
 * closing and costing genuinely are the most expensive thing to get wrong in F&O, and a report
 * layout genuinely is not, and an estimator that scored them alike would be worthless whatever
 * its provenance said.
 */

/** What a rule does to the five parameters. Absent means the rule has no opinion about it. */
type Weights = Partial<Record<ComplexityKey, number>>

interface Rule {
  id: string
  /** Words that mean this, lowercased. Matched against subject, description and module. */
  match: RegExp
  weights: Weights
  /** Stated in the estimate's assumptions, so a person can disagree with the reasoning. */
  because: string
}

/**
 * Subject knowledge, one rule at a time, strongest first.
 *
 * Order matters only for reporting — every matching rule contributes, and the highest weight
 * proposed for a parameter wins rather than the sum. Summing would make an issue that happens to
 * name four areas score 5 everywhere purely for being wordy, which rewards verbosity rather than
 * complexity.
 */
const RULES: readonly Rule[] = [
  {
    id: 'costing',
    match: /\b(costing|standard cost|average cost|moving average|fifo|lifo|weighted average|inventory clos\w*|cost recalculat\w*|inventory valuat\w*|cost roll[- ]?up)\b/,
    weights: { business: 5, technical: 4, data: 5, testing: 5 },
    because:
      'Costing and inventory valuation. In F&O this is the most expensive area to get wrong: it is derived from every posted inventory transaction, correcting it means recalculation or closing adjustment across history, and the regression surface is the whole ledger.',
  },
  {
    id: 'period-close',
    // `closing` on its own matched "closing the issue" and every other ordinary use of the
    // word. It has to be qualified by what is being closed.
    match: /\b(month[- ]?end|period[- ]?end|(inventory|period|month|year|financial) clos\w*|close the (month|period|year)|trial balance|p&l|profit and loss|general ledger|posting (setup|profile)|financial statement)\b/,
    weights: { business: 5, data: 4, testing: 4, technical: 2 },
    because:
      'Month-end and ledger posting. The rules are accounting policy rather than software preference, several people have to agree them, and a mistake is visible to the client in a statement.',
  },
  {
    id: 'tax-statutory',
    match: /\b(tax|vat|gst|withholding|tds|statutory|compliance|audit trail|regulat\w+|e[- ]?invoic\w+)\b/,
    weights: { business: 5, testing: 4, data: 3, technical: 2 },
    because:
      'Statutory or tax requirement. The correct answer is set outside the project, it is not negotiable, and being wrong has a consequence beyond the client.',
  },
  {
    id: 'integration',
    match: /\b(integrat\w+|interface|api|odata|middleware|edi|third[- ]?party|web ?service|webhook|sync\w*|dmf|data management framework|logic app|connector)\b/,
    weights: { integration: 5, technical: 4, testing: 4 },
    because:
      'Crosses a system boundary. Two systems have to agree a contract, failures are asynchronous and land somewhere nobody is watching, and testing needs both ends available at once.',
  },
  {
    id: 'data-migration',
    match: /\b(migrat\w+|item code|master data|opening balance|data ?load|upload|template|reconcil\w+|cutover|legacy data)\b/,
    weights: { data: 5, testing: 4, business: 3 },
    because:
      'Data migration or master-data change. The effort is in the reconciliation rather than the load, and a change to an identifier after go-live reaches every document that already references it.',
  },
  {
    id: 'customisation',
    match: /\b(x\+\+|extension|customis\w+|customiz\w+|custom (code|form|field)|development|plugin|event handler|code|form personalis\w+)\b/,
    weights: { technical: 5, testing: 4 },
    because:
      'Custom development. It carries build, code review, deployment and an upgrade cost that configuration does not, and it is the part that has to be retested at every platform update.',
  },
  {
    id: 'production',
    // `route` alone matched "the same chat route" in a product-backlog item about speech input.
    // A route in this product is a manufacturing route and has to be named as one.
    match: /\b(bom|bill of material|(production|routing) route|routing card|production order|batch (order|number)|formula|scrap|mrp|master plan\w*|shop floor|work cent\w+)\b/,
    weights: { business: 4, testing: 4, technical: 3, data: 3 },
    because:
      'Manufacturing. The setup is interdependent — a route, a BOM and a resource have to be consistent — so a change in one place is tested through the whole production cycle.',
  },
  {
    id: 'warehouse',
    match: /\b(grn|goods receipt|warehouse|on[- ]?hand|inventory (journal|transfer|adjust\w*)|picking|packing|put ?away|licence plate|wms)\b/,
    weights: { business: 3, data: 3, testing: 3, technical: 2 },
    because:
      'Warehouse and inventory movement. Ordinary configuration work, but it moves quantities that other postings depend on, so it is verified rather than assumed.',
  },
  {
    id: 'workflow-approval',
    match: /\b(workflow|approval|approver|hierarch\w+|delegat\w+|escalat\w+ (path|rule))\b/,
    weights: { business: 4, testing: 3, technical: 2 },
    because:
      'Approval workflow. The design question is who decides, which is organisational rather than technical, and each path has to be walked to be tested.',
  },
  {
    id: 'security',
    match: /\b(security|role|permission|privilege|dut(y|ies)|access|segregation of duties|user (setup|access)|authenticat\w+)\b/,
    weights: { business: 3, testing: 3, technical: 2 },
    because:
      'Roles and access. Little or no code, but the work is in deciding what each role may do and then proving it, and the failure mode is silent over-permission.',
  },
  {
    id: 'reporting',
    match: /\b(report\w*|ssrs|power ?bi|dashboard|layout|print\w*|format|label|statement design)\b/,
    weights: { technical: 3, business: 2, testing: 2, data: 2 },
    because:
      'Reporting or print output. Genuine development, but well bounded — the requirement is visible on the page and the test is looking at it.',
  },
  {
    id: 'sales-procurement',
    /*
     * `\bso\b` and `\bpo\b` were here as abbreviations and were a plain mistake: the text is
     * lowercased before matching, so `\bso\b` matched the English word "so" — which appears in
     * a great many sentences that have nothing to do with a sales order. Both now have to carry
     * their noun.
     */
    match: /\b(purchase order|sales order|(po|so) (number|line|print\w*|confirmation)|invoice|vendor|customer|quotation|requisition|pricing|trade agreement)\b/,
    weights: { business: 3, testing: 3, technical: 2 },
    because:
      'Order-to-cash or procure-to-pay configuration. Standard functionality, but it sits on the document flow the client uses every day.',
  },
  {
    id: 'configuration',
    match: /\b(parameter|setup|configur\w+|enable|default value|number sequence|dimension)\b/,
    weights: { business: 2, testing: 2, technical: 1 },
    because: 'Configuration. Bounded work with a setting at the end of it.',
  },
]

/**
 * Nothing crosses a system boundary unless something says it does.
 *
 * Integration is the one parameter that is legitimately 1 for most of a delivery, and giving it
 * a floor of 2 or 3 "to be safe" would inflate every score in the register by the same amount —
 * which changes every size band while telling nobody anything.
 */
const NO_SIGNAL_FLOOR: Weights = { integration: 1 }

/**
 * What this agent knows, declared rather than assumed.
 *
 * Every rule above is a pattern from delivering Dynamics 365 finance and operations. Pointed at
 * something else, the same vocabulary still matches and produces a confident number about work
 * it has entirely misread — which is worse than producing nothing, because the reasoning reads
 * as though it understood.
 *
 * That is not hypothetical. Run against this workspace's own product backlog, an item about
 * turning speech into text matched `period-close`, `production` and `sales-procurement`, and
 * proposed a hundred and sixty hours with an explanation about accounting policy and bills of
 * material. Three of those matches were also plain bugs — `\bso\b` matching the English word
 * "so", `route` matching "chat route", `closing` matching "closing the issue" — and they have
 * been fixed. The gate stays regardless, because tightening a rule reduces the false positives
 * and does not make the agent competent outside what it knows.
 */
export type EstimateDomain = 'd365-fo' | 'other'

export interface EstimateProposal {
  scores: ComplexityScores
  /** False when nothing matched. `deriveEffort` then yields no size and no hours, by design. */
  scored: boolean
  /**
   * Why there is no score, when there is none.
   *
   * `unrecognised` means the agent read it and recognised nothing. `out-of-domain` means it
   * should not have been asked. Reported separately because they call for different actions: the
   * first is a case for extending the rules, the second is somebody pointing the agent at the
   * wrong register.
   */
  outcome: 'scored' | 'unrecognised' | 'out-of-domain'
  confidence: Confidence
  /** Every rule that fired, in the order they are declared. For the estimate's assumptions. */
  basis: string[]
  /** One line naming the rules, for a summary table. */
  summary: string
}

export interface Readable {
  subject: string
  description: string
  module: string
  type: string
  severity: string
}

/**
 * Propose complexity scores for one issue.
 *
 * The text searched is subject, description and module together. Module is included because it
 * is frequently the only signal a two-word issue carries — "FIFO not implemented" filed under
 * Production says more as a pair than either does alone.
 */
export function proposeEstimate(issue: Readable, domain: EstimateDomain): EstimateProposal {
  if (domain !== 'd365-fo') {
    return {
      scores: emptyScores(),
      scored: false,
      outcome: 'out-of-domain',
      confidence: 'Low',
      basis: [],
      summary: "outside this agent's subject knowledge — not estimated",
    }
  }

  const text = `${issue.subject} ${issue.description} ${issue.module}`.toLowerCase()

  const fired = RULES.filter((r) => r.match.test(text))
  const scores = emptyScores()
  const basis: string[] = []

  if (!fired.length) {
    return {
      scores,
      scored: false,
      outcome: 'unrecognised',
      confidence: 'Low',
      basis: [],
      summary: 'nothing recognised — left unscored',
    }
  }

  /*
   * Highest wins per parameter, not the sum. An issue naming costing AND reporting is as hard as
   * the costing part; adding the reporting weight on top would say a costing problem mentioned
   * alongside a report is harder than the same costing problem alone, which is not true.
   */
  for (const rule of fired) {
    for (const [key, value] of Object.entries(rule.weights) as [ComplexityKey, number][]) {
      if (scores[key] === null || value > scores[key]) scores[key] = value
    }
    basis.push(`${rule.id}: ${rule.because}`)
  }

  for (const [key, value] of Object.entries(NO_SIGNAL_FLOOR) as [ComplexityKey, number][]) {
    if (scores[key] === null) scores[key] = value
  }

  /*
   * A change request is new capability rather than a repair of something that was meant to work,
   * so it carries design and agreement the defect does not. A limitation is the product refusing
   * to do something, which means the work is a workaround, and a workaround is designed before
   * it is built.
   */
  if (/change request/i.test(issue.type)) {
    bump(scores, { business: 1, technical: 1 })
    basis.push('type: a change request adds capability, so it carries design and agreement that a repair does not.')
  } else if (/limitation/i.test(issue.type)) {
    bump(scores, { business: 1, technical: 1 })
    basis.push('type: a product limitation means the answer is a workaround, and a workaround has to be designed before it can be built.')
  }

  /*
   * Severity moves testing and nothing else. It says how much it matters that this is wrong,
   * which is an argument for proving the fix rather than evidence that the fix is harder.
   */
  if (/high/i.test(issue.severity)) {
    bump(scores, { testing: 1 })
    basis.push('severity: High. The cost of the fix being wrong is what raises the testing effort, not the fix itself.')
  }

  /*
   * A parameter no rule ever touched is not "unsafe to leave alone" any more — 0 is a real
   * score, "no meaningful effort in this dimension," and the model's own training material
   * treats that as common and honest, not a gap papered over with an assumed floor of 1.
   */
  for (const p of COMPLEXITY_PARAMETERS) {
    const current = scores[p.key]
    scores[p.key] = current === null ? 0 : Math.min(5, current)
  }

  const scored = isScored(scores)
  return {
    scores,
    scored,
    outcome: scored ? 'scored' : 'unrecognised',
    // Always Low, and not because the reading is poor. Confidence is a claim about the estimate,
    // and no person has looked at this one.
    confidence: 'Low',
    basis,
    summary: fired.map((r) => r.id).join(', '),
  }
}

function bump(scores: ComplexityScores, weights: Weights): void {
  for (const [key, value] of Object.entries(weights) as [ComplexityKey, number][]) {
    if (scores[key] !== null) scores[key] = Math.min(5, scores[key] + value)
  }
}

/**
 * The assumptions text an agent-produced estimate carries.
 *
 * Written into the estimate itself rather than left implicit, because the estimate outlives this
 * conversation and the next person to open it has no other way of knowing a machine wrote it.
 * It names what was read, what fired, and — first, because it is the part that matters — that
 * nobody has agreed it.
 */
export function assumptionsFor(proposal: EstimateProposal, agentName: string): string {
  return [
    `Proposed by ${agentName}. NOT agreed by anybody — this is a starting point for a conversation, not a commitment.`,
    '',
    'Scored by reading the issue subject, description and module against known Dynamics 365 finance-and-operations delivery patterns. Vocabulary is a proxy for the work, not the work; correct it freely.',
    '',
    'What it thought it was looking at:',
    ...proposal.basis.map((b) => `  - ${b}`),
  ].join('\n')
}
