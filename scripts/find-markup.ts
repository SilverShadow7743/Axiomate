/**
 * Which stored records still carry raw mail markup.
 *
 *   npx tsx --conditions=react-server scripts/find-markup.ts
 *
 * Read only. It reports and changes nothing — the point is to find out whether a repair pass is
 * worth writing before writing one.
 *
 * ---------------------------------------------------------------------------
 * What counts as markup, and why it is not just "contains a <"
 *
 * A description reading `posting fails when qty < 10` contains a `<` and is perfectly good text.
 * Counting that as markup would report a repair job that does not exist, and — worse — a repair
 * pass built on the same test would rewrite a sentence somebody wrote.
 *
 * So each signal below is one a person would not type by accident, and they are reported
 * separately rather than summed. A record is only a candidate if it carries a real tag or an
 * unmistakable Outlook artefact; entities alone are listed but not counted as needing repair,
 * because `&amp;` occasionally survives a legitimate copy-paste and decoding it is a smaller
 * question than unwrapping a document.
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { loadWorkspace } from '../lib/db/repo'
import { htmlToText } from '../lib/intake'
import { richTextToPlainText } from '../lib/richText'
import type { TenantId } from '../lib/tenant'

const TENANT = (process.env.AXIOMATE_TENANT ?? 'axiocloud') as TenantId

/** An opening or closing tag with a plausible tag name. `< 10` does not match. */
const TAG = /<\/?[a-z][a-z0-9]*(\s[^<>]*)?>/i
/** Things only a mail client emits. Any one of these settles it on its own. */
const OUTLOOK = /<o:p|MsoNormal|urn:schemas-microsoft-com|<!--\[if |mso-/i
/** Named or numeric entities. Reported, not counted — see the module note. */
const ENTITY = /&(#x?[0-9a-f]+|amp|nbsp|lt|gt|quot|ndash|mdash|rsquo|ldquo|rdquo);/i

interface Hit {
  where: string
  id: string
  signals: string[]
  before: number
  after: number
  sample: string
}

function inspect(where: string, id: string, text: string | null | undefined): Hit | null {
  if (!text) return null
  const signals: string[] = []
  if (TAG.test(text)) signals.push('tag')
  if (OUTLOOK.test(text)) signals.push('outlook')
  if (ENTITY.test(text)) signals.push('entity')
  if (!signals.length) return null

  const cleaned = htmlToText(text)
  return {
    where,
    id,
    signals,
    before: text.length,
    after: cleaned.length,
    sample: text.replace(/\s+/g, ' ').slice(0, 120),
  }
}

async function main() {
  const { state } = await loadWorkspace(TENANT)
  const hits: Hit[] = []

  for (const i of Object.values(state.issues)) {
    for (const [field, value] of [
      ['issue.description', richTextToPlainText(i.description)],
      ['issue.subject', i.subject],
      ['issue.nextAction', i.nextAction],
      ['issue.evidence', i.evidence],
    ] as const) {
      const hit = inspect(field, i.id, value)
      if (hit) hits.push(hit)
    }
  }
  for (const n of Object.values(state.notes)) {
    const hit = inspect('note.body', `${n.issueId}/${n.id}`, richTextToPlainText(n.body))
    if (hit) hits.push(hit)
  }
  for (const s of Object.values(state.sows)) {
    for (const [field, value] of [
      ['sow.scope', s.scope],
      ['sow.exclusions', s.exclusions],
      ['sow.acceptanceCriteria', s.acceptanceCriteria],
    ] as const) {
      const hit = inspect(field, s.id, value)
      if (hit) hits.push(hit)
    }
  }

  console.log('AXIOMATE — MARKUP SCAN\n')
  console.log(`  issues scanned : ${Object.keys(state.issues).length}`)
  console.log(`  notes scanned  : ${Object.keys(state.notes).length}`)
  console.log(`  SOWs scanned   : ${Object.keys(state.sows).length}`)

  /* Real markup — a tag or an Outlook artefact. This is the repair job, if there is one. */
  const needsRepair = hits.filter((h) => h.signals.includes('tag') || h.signals.includes('outlook'))
  const entitiesOnly = hits.filter((h) => !needsRepair.includes(h))

  console.log(`\n  carrying real markup : ${needsRepair.length}`)
  console.log(`  entities only        : ${entitiesOnly.length}  (reported, not a repair job on its own)`)

  if (!needsRepair.length && !entitiesOnly.length) {
    console.log('\n  Nothing found. No record in this workspace carries mail markup, so the')
    console.log('  conversion added today is the whole of the fix and no repair pass is needed.')
    return
  }

  for (const group of [
    { label: 'REAL MARKUP', rows: needsRepair },
    { label: 'ENTITIES ONLY', rows: entitiesOnly },
  ]) {
    if (!group.rows.length) continue
    console.log(`\n  ${group.label}`)
    const byField = new Map<string, number>()
    for (const h of group.rows) byField.set(h.where, (byField.get(h.where) ?? 0) + 1)
    for (const [field, n] of [...byField].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${field.padEnd(24)} ${n}`)
    }
    for (const h of group.rows.slice(0, 8)) {
      console.log(`\n    ${h.id}  [${h.signals.join(', ')}]  ${h.before} → ${h.after} chars`)
      console.log(`      ${h.sample}`)
    }
    if (group.rows.length > 8) console.log(`\n    … and ${group.rows.length - 8} more`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
