/**
 * Stop intake filing from an individually addressed mailbox, and redact the passcodes it took.
 *
 *   npx tsx --conditions=react-server scripts/stop-personal-intake.ts           # dry run
 *   npx tsx --conditions=react-server scripts/stop-personal-intake.ts --apply
 *
 * ---------------------------------------------------------------------------
 * What went wrong
 *
 * `INBOX_62` is configured against `sekharn@axiocloudsolutions.com` — the firm's own domain, so
 * not a private mailbox, but **individually addressed**, which is the property that matters. In
 * one day it produced twenty-seven issues, of which roughly seventeen were LinkedIn
 * notifications, newsletters, Pinterest digests, meeting-bot summaries, out-of-office replies and
 * two bank one-time passcodes, all of them readable by twenty-five colleagues.
 *
 * Two things are done here, and a third is deliberately not.
 *
 * ---------------------------------------------------------------------------
 * 1. The mailbox is disabled, not repointed
 *
 * Repointing needs an address that exists, and it needs the Logic App's own `mailboxAddress`
 * parameter changed in the same breath — the app config decides which messages are ACCEPTED and
 * the Logic App decides which mailbox is POLLED. Changing one without the other leaves intake
 * refusing every message with a 409 nobody sees, which is exactly the silent-failure shape this
 * codebase has been caught by before.
 *
 * So this does the half that is unambiguously right and needs no new mailbox: it stops. The
 * engagement-mailbox design says where it should point instead, and that is a decision with a
 * dependency, not a line in a script.
 *
 * ---------------------------------------------------------------------------
 * 2. The passcodes are redacted, not deleted
 *
 * There is no hard delete for an issue, and inventing one for this would be the wrong reflex.
 * `AXM-094` is already archived and `AXM-095` is live; archiving hides a row from the tree and
 * leaves its text in the database, which is not what "remove a passcode" means.
 *
 * What actually needs to go is the code, not the record. So the description is replaced with a
 * line saying what was there and why it is not, the issue stays archived or is archived, and the
 * audit trail carries the reason. The record that a message arrived is true and worth keeping;
 * the six digits are not.
 *
 * A passcode that has been used or expired is not a live credential, and these are days old. This
 * is hygiene rather than an incident, and it is written down as hygiene.
 *
 * ---------------------------------------------------------------------------
 * 3. What is NOT done here
 *
 * The seventeen non-work issues are left alone. Deciding that a newsletter is not work is a
 * judgement about somebody's inbox, and it belongs to a person looking at the list — which is
 * what the triage queue in the connected-workspace design exists to give them. A script that
 * archived everything matching a sender pattern would be the filter that design argues against,
 * applied retrospectively and with less care.
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { loadWorkspace } from '../lib/db/repo'
import { persistActions } from '../lib/db/persist'
import type { Action } from '../lib/workspace'
import type { TenantId } from '../lib/tenant'
import type { Actor } from '../lib/actor'
import { richTextToPlainText, wrapPlainText } from '../lib/richText'

const APPLY = process.argv.includes('--apply')
const TENANT = (process.env.AXIOMATE_TENANT ?? 'axiocloud') as TenantId
const NOW = new Date().toISOString()

/** The two the scan found. Named rather than pattern-matched — see the note on what is not done. */
const PASSCODE_ISSUES = ['AXM-094', 'AXM-095']

const REDACTED =
  '[Redacted 18 August 2026] This issue was created automatically from a bank one-time passcode that arrived at an individually addressed mailbox configured for intake. The passcode has been removed; the record that the message arrived is kept. Intake no longer files from that mailbox.'

async function main() {
  const { state } = await loadWorkspace(TENANT)

  const wanted = (process.env.AXIOMATE_OPERATOR_EMAIL ?? 'sekharn@axiocloudsolutions.com').toLowerCase()
  const operator = Object.values(state.model.people).find((p) => p.email?.toLowerCase() === wanted)
  if (!operator) {
    console.log(`  No directory entry has ${wanted}, so nothing here would be permitted.`)
    process.exitCode = 1
    return
  }
  const ACTOR: Actor = { id: operator.id, name: operator.name, email: operator.email }

  console.log('AXIOMATE — STOP INTAKE FROM AN INDIVIDUAL MAILBOX\n')
  console.log(`  attributed to : ${operator.name} (${operator.id})\n`)

  const actions: Action[] = []

  /* ---- 1. the mailbox ---- */
  for (const box of state.model.intake) {
    const individual = Object.values(state.model.people).find(
      (p) => p.email?.toLowerCase() === box.address.toLowerCase(),
    )
    console.log(`  ${box.id}  ${box.address}`)
    console.log(`    enabled: ${box.enabled} | files into: ${box.scopeId}`)
    if (!individual) {
      console.log('    Not an individual in the directory — left alone.')
      continue
    }
    console.log(`    This is ${individual.name}'s own address.`)
    if (!box.enabled) {
      console.log('    Already disabled — nothing to do.')
      continue
    }
    console.log('    WILL DISABLE. Repointing needs an address that exists and a matching change')
    console.log('    to the Logic App parameter; see the connected-workspace design.')
    actions.push({
      t: 'config',
      op: { k: 'upsertIntake', id: box.id, patch: { enabled: false } },
      now: NOW,
    } as Action)
  }

  /* ---- 2. the passcodes ---- */
  console.log('\n  Passcode issues:')
  for (const id of PASSCODE_ISSUES) {
    const issue = state.issues[id]
    if (!issue) {
      console.log(`    ${id}  not found — skipped.`)
      continue
    }
    const descriptionText = richTextToPlainText(issue.description)
    const already = descriptionText.startsWith('[Redacted')
    console.log(
      `    ${id}  ${issue.deletedAt ? 'archived' : 'LIVE'}  ${descriptionText.length} chars  ${already ? '(already redacted)' : ''}`,
    )
    console.log(`      ${issue.subject.slice(0, 78)}`)
    if (already) continue

    actions.push({
      t: 'updateIssue',
      id,
      patch: { description: wrapPlainText(REDACTED) },
      reason: 'Bank one-time passcode removed. The record that the message arrived is kept; the code is not.',
      now: NOW,
    } as Action)
    /* Archive the live one too, so neither sits in the tree as though it were work. */
    if (!issue.deletedAt) {
      actions.push({ t: 'softDelete', id, mode: 'reparent', now: NOW } as Action)
    }
  }

  console.log(`\n  ${actions.length} action(s) to apply.`)
  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply.')
    return
  }
  if (!actions.length) {
    console.log('  Nothing to do.')
    return
  }

  const result = await persistActions(TENANT, ACTOR, actions)
  console.log(`\n  ${result.ok ? 'Applied' : 'Refused'}: ${result.message ?? result.error}`)
  if (!result.ok) {
    process.exitCode = 1
    return
  }

  const { state: after } = await loadWorkspace(TENANT)
  const live = after.model.intake.filter((b) => b.enabled)
  console.log(`  Enabled intake mailboxes now: ${live.length ? live.map((b) => b.address).join(', ') : 'none'}`)
  for (const id of PASSCODE_ISSUES) {
    const i = after.issues[id]
    if (i) console.log(`  ${id}: ${i.deletedAt ? 'archived' : 'live'}, ${richTextToPlainText(i.description).length} chars`)
  }
  console.log('\n  Client mail will stop arriving until a mailbox is configured that is not an')
  console.log('  individual’s. That is the trade, and it is deliberate.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
