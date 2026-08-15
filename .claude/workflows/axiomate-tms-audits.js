export const meta = {
  name: 'axiomate-tms-audit',
  description: 'Multi-dimension audit of the Axiomate TMS app with adversarial verification',
  phases: [
    { title: 'Review', detail: 'independent reviewers, one per dimension' },
    { title: 'Verify', detail: 'adversarial refutation of each finding' },
    { title: 'Synthesise', detail: 'rank confirmed findings' },
  ],
}

const ROOT = 'C:/Axiomate-TMS'

const DIMENSIONS = [
  {
    key: 'correctness',
    prompt: `Review the scheduling and domain logic in ${ROOT}/lib for real defects.
Read: schedule.ts, tree.ts, workspace.ts, dates.ts, timeline.ts, panel.ts, sort.ts, editing.ts.
Focus on: off-by-one errors in date math; the critical-path forward pass (FS/SS/FF/SF handling, lag, milestone zero-duration); roll-up correctness when children are mixed scheduled/unscheduled; soft-delete reparenting edge cases; the move operation's client/module denormalisation loop; dependency cycle detection; percentOverride vs status-derived progress precedence.
Report only defects that would produce a WRONG RESULT for some concrete input. Do not report style, naming, or missing tests.`,
  },
  {
    key: 'data-honesty',
    prompt: `The core constraint of this app: the source issue log has NO due dates, no activity breakdown, and no progress figures. The app must never present derived or invented values as recorded facts.
Read ${ROOT}/scripts/transform-issues.mjs, ${ROOT}/lib/schedule.ts, ${ROOT}/lib/tree.ts, ${ROOT}/components/DetailPanel.tsx, ${ROOT}/components/GanttChart.tsx, ${ROOT}/components/IssueFocus.tsx, ${ROOT}/README.md.
Find any place where a derived, proposed, or defaulted value is displayed WITHOUT being labelled as such, or where the UI could mislead a user into thinking a date/percentage came from the source log. Also flag any claim in the README that the code does not actually support.
Report only genuine provenance/labelling violations.`,
  },
  {
    key: 'react-state',
    prompt: `Review React correctness in ${ROOT}/components (IssueWorkspace.tsx, IssueFocus.tsx, TreeGrid.tsx, GanttChart.tsx, DetailPanel.tsx, Dialogs.tsx, FilterBar.tsx, SelectionToolbar.tsx).
Focus on: stale closures in useCallback/useEffect dependency arrays; effects that register listeners without cleanup; the useEffect in IssueFocus with NO dependency array (is it correct or a bug?); state derived during render that should be memoised; keys on mapped lists; controlled-input patterns; the scroll-sync guard between the two panes; event listeners added on every render.
Report only defects that cause incorrect behaviour, a leak, or a visible bug. Not style.`,
  },
  {
    key: 'css-layout',
    prompt: `Review ${ROOT}/app/globals.css against the components that use it.
Focus on: selector specificity collisions (e.g. broad rules like ".fld input { width: 100% }" hitting inputs that must not stretch); z-index stacking conflicts between .sticky-col, .gc.editing, .focus, .drawer-scrim, .modal-scrim, .toast, .today-line, .dep-layer; dark-mode tokens that are defined in only one of the three theme blocks; rules referencing class names no longer present in any component (dead CSS); horizontal overflow risks.
Read the component files to confirm each finding is real. Report only genuine conflicts or dead rules.`,
  },
  {
    key: 'a11y',
    prompt: `Review accessibility across ${ROOT}/components.
Focus on: interactive elements built from non-interactive tags without role/tabIndex/keyboard handlers (twisty toggles, gantt bars, row selection, resize grips); missing labels on form controls; colour used as the only signal; focus management when the focus-mode overlay and modals open/close (is focus trapped? returned?); aria-modal usage without a focus trap; the drag handles.
Report concrete, fixable accessibility defects with file:line. Prioritise keyboard operability over ARIA nitpicks.`,
  },
  {
    key: 'dead-code',
    prompt: `Find dead or inconsistent code in ${ROOT} (lib/, components/, app/, scripts/, prisma/).
Look for: exported functions/constants/types never imported anywhere; component props that are passed but never used, or declared but never passed; CSS class names in components with no matching rule in globals.css; the ACTIVE_STATUSES/CLOSING_STATUSES and status-chip styles after the recent switch to a dropdown; leftovers from the deleted IssueDrawer component; package.json scripts referencing files that do not exist; README statements about files that no longer exist.
Use grep to CONFIRM each item is genuinely unreferenced before reporting it.`,
  },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          detail: { type: 'string' },
          failureScenario: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
        required: ['title', 'file', 'severity', 'detail', 'failureScenario'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
    correctedSeverity: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['refuted', 'reasoning'],
}

phase('Review')

// Each dimension verifies its own findings as soon as it finishes — no barrier.
const perDimension = await pipeline(
  DIMENSIONS,
  (d) => agent(d.prompt, { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }),
  (res, d) => {
    if (!res || !res.findings || !res.findings.length) return []
    // Cap per dimension so one noisy reviewer cannot dominate the verify budget.
    const take = res.findings.slice(0, 6)
    if (res.findings.length > take.length) {
      log(`${d.key}: ${res.findings.length} findings, verifying top ${take.length}`)
    }
    return parallel(
      take.map((finding) => () =>
        agent(
          `You are verifying a code-review finding against the real repository at ${ROOT}.

CLAIM: ${finding.title}
FILE: ${finding.file}${finding.line ? ':' + finding.line : ''}
DETAIL: ${finding.detail}
CLAIMED FAILURE: ${finding.failureScenario}

Open the file and read the actual code. Try hard to REFUTE this claim. It is refuted if:
- the code does not say what the claim says it says
- the described failure cannot actually occur (guarded elsewhere, unreachable, wrong reading)
- it is a style/preference opinion rather than a defect
- it describes intended, documented behaviour

Note: this app deliberately shows "Unscheduled" and status-derived progress because the source
data has no due dates. That is intended behaviour, not a bug. Deliberate design choices
documented in code comments are NOT defects.

Default to refuted=true when uncertain. Only set refuted=false if you verified the specific
line(s) and the failure genuinely occurs.`,
          { label: `verify:${d.key}`, phase: 'Verify', schema: VERDICT_SCHEMA },
        ).then((v) => ({ ...finding, dimension: d.key, verdict: v })),
      ),
    )
  },
)

const all = perDimension.flat().filter(Boolean)
const confirmed = all.filter((f) => f.verdict && f.verdict.refuted === false)

log(`${all.length} findings verified, ${confirmed.length} survived refutation`)

if (!confirmed.length) {
  return { confirmed: [], summary: 'No findings survived adversarial verification.' }
}

phase('Synthesise')

const summary = await agent(
  `These code-review findings for the Axiomate TMS app survived adversarial verification:

${JSON.stringify(confirmed.map((c) => ({
    dimension: c.dimension,
    title: c.title,
    file: c.file,
    line: c.line,
    severity: c.verdict.correctedSeverity || c.severity,
    detail: c.detail,
    failure: c.failureScenario,
    fix: c.suggestedFix,
  })), null, 2)}

Produce a prioritised action list. Merge duplicates that are the same underlying defect found
by different reviewers. Rank strictly by user impact: a wrong result or broken interaction
outranks a latent risk, which outranks cleanup. For each item give a one-line fix instruction
precise enough to act on without re-reading the whole file. Be concise; no preamble.`,
  { label: 'synthesise', phase: 'Synthesise' },
)

return { count: confirmed.length, confirmed, summary }
