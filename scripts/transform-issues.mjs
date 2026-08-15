/**
 * Transform the raw OAPIL/SLG issue log into the app's seed shape.
 *
 * Provenance rules enforced here (these are the reason this file exists):
 *   - `raised` and `lastAct` are the ONLY dates present in the source log. They become
 *     actual dates, tagged `source`.
 *   - The log contains NO due dates, commitment dates or closure dates (committedDate,
 *     closedOn and committedOn are empty in all 179 rows — they were runtime fields of the
 *     board this data came from). So `plannedEndDate` is left null. Nothing is invented.
 *   - `percentComplete` on an issue is derived from its status via a published table and
 *     tagged `status-derived`.
 *   - Lifecycle activities (Investigation / RCA / ...) are NOT generated. The log has no
 *     activity breakdown, so they are created only when a user asks for them in the app.
 *   - `_partner`, `_rawAcc`, `_rawOwn` are the source board's private register fields and
 *     are dropped.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const raw = JSON.parse(readFileSync(join(root, 'data/issues.raw.json'), 'utf8'))

const TERMINAL = new Set(['Closed - confirmed', 'Closed - no defect', 'Superseded'])
const STATUS_PROGRESS = {
  Open: 0,
  'Needs clarification': 10,
  'In Progress': 50,
  'Awaiting client confirmation': 80,
  'Closed - confirmed': 100,
  'Closed - no defect': 100,
  Superseded: 100,
}

/**
 * The log's own classification, mapped onto the blueprint's Work Item taxonomy.
 *
 * Requested deliberately, and it is a lossy translation, so both sides are written down: the
 * blueprint type goes to `type`, the recorded one to `sourceType`, and `issues.raw.json` keeps
 * the original untouched. Re-running this script reproduces the mapping from that source, so
 * nothing here is a one-way edit.
 *
 * Two collapses are worth knowing about, because they lose a distinction the firm was making:
 *
 *   Query, Access Request, Estimate Request  → Request   (37 records)
 *   Data Issue, Escalation                   → Issue     (35 records)
 *
 * After this, nothing in `type` can tell an access request from a request for an estimate.
 * That is why `sourceType` exists rather than being optional tidiness — the Data Source tab
 * is where a record says what it originally was, and this is exactly such a case.
 *
 * Throwing on an unmapped type follows the rule already set for status below: a classification
 * this script does not recognise is a decision for a person, not something to guess at.
 */
const BLUEPRINT_TYPE = {
  Defect: 'Defect',
  'Change Request': 'Change Request',
  // Requests: someone is asking the delivery team for something.
  Query: 'Request',
  'Access Request': 'Request',
  'Estimate Request': 'Request',
  // Problems requiring resolution — the blueprint's own words for Issue.
  'Data Issue': 'Issue',
  Escalation: 'Issue',
  // Work to be carried out rather than a problem to be resolved.
  'Environment/Build': 'Task',
  // A follow-up someone has to perform; the blueprint's Action.
  'Status Chase': 'Action',
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const issues = []
const relationships = []

for (const r of raw) {
  const terminal = TERMINAL.has(r.status)
  const status = r.status
  if (!(status in STATUS_PROGRESS)) {
    throw new Error(`Unmapped status "${status}" on ${r.id} — refusing to guess its progress.`)
  }

  issues.push({
    id: r.id,
    client: r.client,
    module: r.module || 'Unclassified',
    subject: r.subject || '(no subject recorded)',
    description: r.desc || '',
    type: (() => {
      const mapped = BLUEPRINT_TYPE[r.type]
      if (!mapped) {
        throw new Error(`Unmapped work type "${r.type}" on ${r.id} — refusing to guess its class.`)
      }
      return mapped
    })(),
    /** What the log actually called it, kept because the mapping above is lossy. */
    sourceType: r.type,
    severity: r.sev,
    status,
    owner: r.owner || 'Unassigned',
    raisedBy: r.raisedBy || '',
    accountable: r.acc || 'Unassigned',

    // Real, recorded dates.
    raised: r.raised,
    lastActivity: r.lastAct,
    // A terminal issue's last recorded activity is its effective completion date.
    // Tagged `derived` downstream because the log has no explicit closure date.
    actualEnd: terminal ? r.lastAct : null,

    age: r.age,
    daysSinceActivity: r.dsa,
    percentComplete: STATUS_PROGRESS[status],

    nextAction: r.next || '',
    evidence: r.evidence || '',
    evidenceDate: r.evDate || '',
    verification: r.verif || '',
    source: r.source || '',
    reference: r.ref || '',
    clientImpact: r.clientImpact || '',
  })

  // `dup` records a duplicate link. That is a BUSINESS relationship, not a schedule
  // constraint, so it goes to IssueRelationship — never to IssueDependency (spec §14).
  if (r.dup) {
    const targets = String(r.dup).match(/(?:OAPIL|SLG)-\d+/g) || []
    for (const t of targets) {
      if (t === r.id) continue
      relationships.push({
        id: `rel-${slug(r.id)}-${slug(t)}`,
        sourceIssueId: r.id,
        targetIssueId: t,
        relationshipType: 'DUPLICATE_OF',
        note: String(r.dup),
      })
    }
  }
}

issues.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))

const clients = [...new Set(issues.map((i) => i.client))].sort()
const modules = [...new Set(issues.map((i) => i.module))].sort()
const owners = [...new Set(issues.map((i) => i.owner))].sort()

const seed = {
  meta: {
    source: 'OAPIL / SLG consolidated issue log (v2), 179 issues',
    generatedFrom: 'data/issues.raw.json',
    issueCount: issues.length,
    clients,
    dateRange: {
      earliestRaised: issues.reduce((a, i) => (i.raised < a ? i.raised : a), issues[0].raised),
      latestActivity: issues.reduce(
        (a, i) => (i.lastActivity > a ? i.lastActivity : a),
        issues[0].lastActivity,
      ),
    },
    provenance: {
      recordedDates: ['raised', 'lastActivity'],
      absentFromSource: ['plannedStartDate', 'plannedEndDate', 'closureDate', 'percentComplete'],
      derived: {
        actualEnd: 'lastActivity of an issue in a terminal status',
        percentComplete: 'status -> % table (STATUS_PROGRESS); shown as status-derived',
      },
      notGenerated: ['lifecycle activities', 'schedule dependencies', 'due dates'],
    },
  },
  issues,
  relationships,
  dependencies: [], // Populated only when a user builds a lifecycle plan.
  facets: { clients, modules, owners },
}

writeFileSync(join(root, 'data/issues.seed.json'), JSON.stringify(seed, null, 2))

console.log(`Wrote data/issues.seed.json`)
console.log(`  issues:        ${issues.length}`)
console.log(`  clients:       ${clients.join(', ')}`)
console.log(`  modules:       ${modules.length}`)
console.log(`  owners:        ${owners.length}`)
console.log(`  relationships: ${relationships.length} (duplicate links, business-level)`)
console.log(`  dependencies:  0 (none in source; created by users in-app)`)
console.log(`  date range:    ${seed.meta.dateRange.earliestRaised} -> ${seed.meta.dateRange.latestActivity}`)
