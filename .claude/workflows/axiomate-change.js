export const meta = {
  name: 'axiomate-change',
  description: 'Take one Axiomate TMS change through the Intent, Build or Proof orchestra, stopping at each human gate',
  whenToUse: 'A request, incident or debt item that should travel as checked artifacts rather than ad-hoc edits. Run with args.stage = intent | build | proof.',
  phases: [
    { title: 'Intent', detail: 'three analysts in parallel, then the specification and risk assessment' },
    { title: 'Plan', detail: 'implementation plan; stops for the architect on protected paths' },
    { title: 'Implement', detail: 'plan steps in order, each verified by its own command' },
    { title: 'Review', detail: 'find defects, then try to refute each one' },
    { title: 'Proof', detail: 'standing gate, coverage, security; validation result' },
  ],
}

// args: { stage: 'intent'|'build'|'proof', request?: string, requirementId?: string,
//         changeSetId?: string, today: 'YYYY-MM-DD', seq: number, by: string, run: string }
// The runtime has no clock, so `today`, the next artifact sequence and the run id arrive here.
// Design: docs/plans/2026-09-05-agentic-operating-model-design.md. Plan step 6.

const ROOT = 'C:/Axiomate-TMS'
const a = args || {}
if (!a.stage || !a.today || a.seq === undefined || !a.run) {
  throw new Error('axiomate-change needs args { stage, today, seq, run } — see the header comment')
}
const pad = (n) => String(n).padStart(3, '0')
const artId = (offset) => `ART-${a.today.replace(/-/g, '')}-${pad(Number(a.seq) + offset)}`
const CHECK = `cd ${ROOT} && npm run audit:contracts`

const ANALYSIS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    detail: { type: 'string' },
    protectedPathsImplicated: { type: 'array', items: { type: 'string' } },
    designIsOpen: { type: 'boolean' },
    disagreements: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'detail', 'protectedPathsImplicated', 'designIsOpen', 'disagreements'],
}
const IDS = {
  type: 'object',
  properties: {
    ids: { type: 'array', items: { type: 'string' } },
    awaiting: { type: ['string', 'null'] },
    checkerPassed: { type: 'boolean' },
    note: { type: 'string' },
  },
  required: ['ids', 'awaiting', 'checkerPassed', 'note'],
}
const STATUS = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    approvedByRole: { type: 'array', items: { type: 'string' } },
    adrIds: { type: 'array', items: { type: 'string' } },
    adrAllApproved: { type: 'boolean' },
    title: { type: 'string' },
  },
  required: ['status', 'approvedByRole', 'adrIds', 'adrAllApproved', 'title'],
}
const PLAN = {
  type: 'object',
  properties: {
    planId: { type: 'string' },
    needsArchitect: { type: 'boolean' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { n: { type: 'integer' }, title: { type: 'string' }, workstream: { type: 'string' }, verify_command: { type: 'string' } },
        required: ['n', 'title', 'workstream', 'verify_command'],
      },
    },
    checkerPassed: { type: 'boolean' },
  },
  required: ['planId', 'needsArchitect', 'steps', 'checkerPassed'],
}
const STEP = {
  type: 'object',
  properties: { n: { type: 'integer' }, verified: { type: 'boolean' }, commits: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } },
  required: ['n', 'verified', 'commits', 'note'],
}
const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, file: { type: 'string' }, line: { type: 'integer' }, detail: { type: 'string' }, failureScenario: { type: 'string' }, severity: { type: 'string' } },
        required: ['title', 'file', 'detail', 'failureScenario', 'severity'],
      },
    },
  },
  required: ['findings'],
}
const VERDICT = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['refuted', 'reason'],
}

const guard = `You are one agent in the Axiomate operating model (${ROOT}/docs/plans/2026-09-05-agentic-operating-model-design.md).
Read ${ROOT}/CLAUDE.md first. Never set status "approved" on any artifact. Never merge to master. Never touch production settings.`

// ============================================================================================
if (a.stage === 'intent') {
  if (!a.request) throw new Error('stage intent needs args.request')
  phase('Intent')
  log('Three analysts read the same request in parallel')

  const lenses = [
    {
      key: 'requirement',
      prompt: `${guard}
Act as the Requirement Analyst using the skills at ${ROOT}/.claude/skills/axiomate-requirement-analysis and axiomate-acceptance-criteria.
REQUEST: ${a.request}
Produce: the problem in one paragraph; the source and its evidence level (E1 stated by a person, E3 inferred); scope in; scope out; Given/When/Then acceptance criteria numbered AC1..; business rules; domain entities from ${ROOT}/lib/types.ts; open questions. Put the full text in "detail". Never invent a source.`,
    },
    {
      key: 'architecture',
      prompt: `${guard}
Act as the Domain & Architecture Analyst using ${ROOT}/.claude/skills/axiomate-domain-analysis, axiomate-solution-architecture, axiomate-work-model, axiomate-tenant-isolation.
REQUEST: ${a.request}
Read ${ROOT}/lib/types.ts, ${ROOT}/lib/workspace.ts (reducer arms), ${ROOT}/prisma/schema.prisma as needed. Name affected entities and modules; whether any protected path is implicated (lib/workspace.ts, lib/types.ts, lib/access.ts, middleware.ts, prisma/schema.prisma, prisma/migrations/, .github/workflows/); whether the design is genuinely open (more than one defensible approach) and if so the alternatives with what each would cost. Check the four principles: tenant isolation, pure reducer, attribution as parameter, derived never stored. Full text in "detail".`,
    },
    {
      key: 'ux',
      prompt: `${guard}
Act as UX Placement, following ${ROOT}/.claude/agents/ui-ux-architect.md and ${ROOT}/docs/design/.
REQUEST: ${a.request}
Say where the change lives in the existing information architecture, which existing pattern it reuses, and if a new pattern is needed, the stated reason. If nothing visible changes, say so in one line. Full text in "detail".`,
    },
  ]

  const analyses = (await parallel(lenses.map((l) => () => agent(l.prompt, { label: `analyse:${l.key}`, phase: 'Intent', schema: ANALYSIS }).then((r) => ({ key: l.key, ...r }))))).filter(Boolean)
  if (analyses.length < 3) log(`only ${analyses.length}/3 analyses returned; the orchestrator will say which is missing`)

  const specId = artId(0)
  const riskId = artId(1)
  const adrId = artId(2)
  const result = await agent(
    `${guard}
You are the intent-orchestrator (${ROOT}/.claude/agents/intent-orchestrator.md). Synthesise, do not average.
REQUEST: ${a.request}
ANALYSES: ${JSON.stringify(analyses, null, 2)}

Write these files, validated against ${ROOT}/.claude/contracts/:
1. ${ROOT}/docs/artifacts/${specId}.requirement-specification.json — status "proposed", producer {agent:"intent-orchestrator", run:"${a.run}"}, created "${a.today}", traces [], approvals []. Body per the schema.
2. ${ROOT}/docs/artifacts/${riskId}.risk-assessment.json — status "final", same producer, traces ["${specId}"], subject_ref "${specId}". If the analysts disagree, requires_human true with each position in reasons.
3. Only if the architecture analysis says the design is open: ${ROOT}/docs/artifacts/${adrId}.architecture-decision.json with producer {agent:"domain-architecture-analyst", run:"${a.run}"}, status "proposed", adr_path "docs/adr/NNNN-<slug>.md" using the next number in ${ROOT}/docs/adr/, and write that ADR file in the format ${ROOT}/docs/adr/README.md gives.
Then run: ${CHECK}
Fix anything it names. Return the ids written, awaiting "product-owner", whether the checker passed, and a one-paragraph note for the product owner.`,
    { label: 'synthesise', phase: 'Intent', schema: IDS },
  )
  return { stage: 'intent', ...result }
}

// ============================================================================================
if (a.stage === 'build') {
  if (!a.requirementId) throw new Error('stage build needs args.requirementId')
  phase('Plan')

  const status = await agent(
    `Read ${ROOT}/docs/artifacts/${a.requirementId}.requirement-specification.json and every ${ROOT}/docs/artifacts/*.architecture-decision.json whose traces include it or that it traces. Return its status, the roles in its approvals, the ADR ids found, whether every ADR is approved, and the title. Read only.`,
    { label: 'preconditions', phase: 'Plan', schema: STATUS },
  )
  if (!status) return { stage: 'build', awaiting: 'unknown', note: 'precondition read failed' }
  if (status.status !== 'approved' || !status.approvedByRole.includes('product-owner')) {
    return { stage: 'build', awaiting: 'product-owner', id: a.requirementId, note: `specification is ${status.status}` }
  }
  if (!status.adrAllApproved) return { stage: 'build', awaiting: 'architect', ids: status.adrIds }

  const planId = artId(0)
  const plan = await agent(
    `${guard}
You are the build-orchestrator (${ROOT}/.claude/agents/build-orchestrator.md), step 1 and 2 only: plan, then gate.
Specification: ${ROOT}/docs/artifacts/${a.requirementId}.requirement-specification.json ("${status.title}").
Read the two most recent ${ROOT}/docs/plans/*-plan.md for the house shape. Write ${ROOT}/docs/artifacts/${planId}.implementation-plan.json:
producer {agent:"implementation-planner", run:"${a.run}"}, created "${a.today}", traces ["${a.requirementId}"], status "proposed".
Order pure logic → callers → storage → UI. Each step has a real verify_command. Workstreams' owns lists are disjoint. Declare protected_paths_touched honestly against ${ROOT}/.claude/contracts/registry.json protectedPaths. Migration always its own commit boundary.
If protected_paths_touched is non-empty or migration is true: leave status "proposed", needsArchitect true.
Otherwise set status "approved" with approvals [{role:"engineering-lead", by:"${a.by || 'dispatching human'}", date:"${a.today}", evidence:"auto-approved: no protected path, no migration"}], needsArchitect false.
Run: ${CHECK}. Return planId, needsArchitect, the steps (n, title, workstream, verify_command), checkerPassed.`,
    { label: 'plan', phase: 'Plan', schema: PLAN },
  )
  if (!plan || !plan.checkerPassed) return { stage: 'build', awaiting: 'fix-plan', planId, note: 'plan did not pass the contract check' }
  if (plan.needsArchitect) return { stage: 'build', awaiting: 'architect', planId, note: 'plan touches a protected path or migration' }

  phase('Implement')
  const branch = `feat/${a.requirementId}`
  log(`Implementing ${plan.steps.length} step(s) in order on ${branch}`)
  const done = []
  for (const step of plan.steps) {
    const r = await agent(
      `${guard}
You are an implementer (level 4) under the build-orchestrator, on branch ${branch} in ${ROOT} (create it from master if it does not exist: git checkout -b ${branch} || git checkout ${branch}).
Plan: ${ROOT}/docs/artifacts/${planId}.implementation-plan.json. Do STEP ${step.n} only: "${step.title}" (workstream ${step.workstream}).
Touch only paths in that workstream's owns list. Use ${ROOT}/.claude/skills/axiomate-feature-builder (or axiomate-screen-builder / axiomate-refactoring as the step warrants).
When done run exactly: cd ${ROOT} && ${step.verify_command}
If it exits non-zero, fix and re-run until it passes or you can explain precisely why it cannot within the plan. Commit at the plan's commit boundaries with a message naming ${a.requirementId}; if this step is not at a boundary, leave the work staged and say so.
Return n, verified (the command exited 0), the commit shas you made, and a one-line note.`,
      { label: `step:${step.n}`, phase: 'Implement', schema: STEP },
    )
    done.push(r || { n: step.n, verified: false, commits: [], note: 'implementer returned nothing' })
    if (!r || !r.verified) {
      log(`step ${step.n} did not verify; stopping before dependent steps`)
      break
    }
  }
  const allVerified = done.length === plan.steps.length && done.every((d) => d.verified)

  phase('Review')
  const found = await agent(
    `${guard}
You are the Adversarial Reviewer (level 1, read-only) using ${ROOT}/.claude/skills/axiomate-code-review.
Review the diff of ${branch} against master in ${ROOT} (git diff master...${branch}). Also confirm every changed file is inside its workstream's owns list in ${ROOT}/docs/artifacts/${planId}.implementation-plan.json; a file outside is a finding of severity high.
Report only defects that produce a wrong result, a leak, a tenant-isolation or attribution break, or an ownership violation. No style.`,
    { label: 'find', phase: 'Review', schema: FINDINGS },
  )
  const findings = found ? found.findings : []
  const verified = await pipeline(
    findings,
    (f) => agent(
      `Verify this code-review finding against ${ROOT} on branch ${branch}. CLAIM: ${f.title} FILE: ${f.file}${f.line ? ':' + f.line : ''} DETAIL: ${f.detail} CLAIMED FAILURE: ${f.failureScenario}
Open the file. Try hard to REFUTE it: refuted if the code does not say what is claimed, the failure cannot occur, it is style, or it is documented intended behaviour. Default refuted=true when uncertain.`,
      { label: `refute:${f.file}`, phase: 'Review', schema: VERDICT },
    ).then((v) => ({ ...f, refuted: v ? v.refuted : true, reason: v ? v.reason : 'no verdict' })),
  )
  const confirmed = verified.filter(Boolean).filter((f) => !f.refuted)
  log(`${findings.length} finding(s), ${confirmed.length} survived refutation`)

  const csId = artId(1)
  const cs = await agent(
    `${guard}
You are the build-orchestrator finishing steps 5 and 6. Branch ${branch} in ${ROOT}. Plan ${planId}.
CONFIRMED FINDINGS: ${JSON.stringify(confirmed, null, 2)}
STEP RESULTS: ${JSON.stringify(done, null, 2)}  ALL VERIFIED: ${allVerified}
Fix each confirmed finding within the plan's ownership, re-run the affected step's verify_command, commit. If one cannot be fixed inside the plan, leave it and mark the review verdict "blocked".
Then write ${ROOT}/docs/artifacts/${csId}.change-set.json: status "final", producer {agent:"build-orchestrator", run:"${a.run}"}, created "${a.today}", traces ["${a.requirementId}", "${planId}"], body with branch "${branch}", base (master sha), commits (all shas on the branch), files with workstream, plan_ref "${planId}", self_validation {commands run, passed: ${allVerified}}, review {findings_confirmed: ${confirmed.length}, findings_open, verdict clean|fixed|blocked}.
Run: ${CHECK}. Return the ids written, awaiting "proof", checkerPassed, and a note.`,
    { label: 'change-set', phase: 'Review', schema: IDS },
  )
  return { stage: 'build', planId, branch, allVerified, confirmedFindings: confirmed.length, ...cs }
}

// ============================================================================================
if (a.stage === 'proof') {
  if (!a.changeSetId) throw new Error('stage proof needs args.changeSetId')
  phase('Proof')
  const vrId = artId(0)
  const result = await agent(
    `${guard}
You are the proof-orchestrator (${ROOT}/.claude/agents/proof-orchestrator.md). Change set: ${ROOT}/docs/artifacts/${a.changeSetId}.change-set.json.
Follow your sequence exactly: ownership check; Gate Runner (record exit code and last lines as evidence for each command; a gate that did not run is "skipped" with the reason, never "pass"); scenario comparison against master's data/validation.json for regressions; acceptance-criterion coverage; security review with axiomate-security-review and axiomate-tenant-isolation; verdict.
Write ${ROOT}/docs/artifacts/${vrId}.validation-result.json: status "final", producer {agent:"proof-orchestrator", run:"${a.run}"}, created "${a.today}", traces ["${a.changeSetId}"].
Run: ${CHECK}. Return ids, awaiting ("security-approver" if any high finding, else "release-approver" on pass/conditional, else "build" on fail), checkerPassed, note with the verdict.`,
    { label: 'prove', phase: 'Proof', schema: IDS },
  )
  return { stage: 'proof', ...result }
}

throw new Error(`unknown stage ${a.stage}; use intent | build | proof`)
