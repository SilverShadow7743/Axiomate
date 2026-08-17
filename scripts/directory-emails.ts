/**
 * Give the directory the addresses it needs to recognise a sign-in.
 *
 * `rolesFor` matches a signed-in person to this directory by id, then address, then display
 * name. Only the last of those works today, and the code that does it says why that is thin:
 * a name is neither stable nor unique. Somebody married, corrected or re-imported stops
 * matching, and with the fallback role now empty they get no permissions at all rather than
 * quietly getting Administrator — which is the right failure, and still a failure.
 *
 * ---------------------------------------------------------------------------
 * Where the addresses come from, and where they do not
 *
 * Not from the issue log: exactly one address appears anywhere in it, and it is a shared
 * Axiocloud mailbox rather than a person. Not invented, obviously.
 *
 * From the tenant's own directory. The client-side people are already there as guests — they
 * were invited so they could be given access to something, and their real addresses came with
 * them. That is a better source than anything in the workspace, because it is the same
 * directory the sign-in itself will authenticate against: an address matched here is an
 * address that can actually arrive in a token.
 *
 * ---------------------------------------------------------------------------
 * How a name is matched to an account
 *
 * Both sides become a set of lowercase word-parts, and the account contributes the local part
 * of its address as well as its display name — because a guest is very often "mada.ravi" with
 * no display name worth having. A directory name matches an account when every one of its
 * words is present, allowing a word to sit inside a longer one so that "Nirmal" and "Kumar"
 * both find "nirmalkumar".
 *
 * Words of two letters or fewer are ignored. "Al" and "R" are particles and initials, and
 * letting them match anything containing those letters is how the wrong person gets an address.
 *
 * An ambiguous name — two accounts that both satisfy it — is reported and left alone. Guessing
 * there means giving one person's sign-in another person's permissions.
 *
 *   npx tsx --conditions=react-server scripts/directory-emails.ts          # dry run
 *   npx tsx --conditions=react-server scripts/directory-emails.ts --apply
 */
import fs from 'node:fs'
import { config as loadEnv } from 'dotenv'
loadEnv()

import { loadWorkspace } from '../lib/db/repo'
import { persistActions } from '../lib/db/persist'
import type { Action } from '../lib/workspace'
import type { TenantId } from '../lib/tenant'
import type { Actor } from '../lib/actor'

const APPLY = process.argv.includes('--apply')
const TENANT = (process.env.AXIOMATE_TENANT ?? 'axiocloud') as TenantId
const ACTOR: Actor = { id: 'directory-emails', name: process.env.AXIOMATE_OPERATOR ?? 'Operator' }
const NOW = new Date().toISOString()

/** Written by `az ad user list`; see the runbook note at the foot of this file. */
const USERS_FILE = process.env.AXIOMATE_TENANT_USERS ?? 'tenant-users.json'

interface TenantUser { displayName: string; mail: string }

const MIN_WORD = 3

const words = (s: string) =>
  s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= MIN_WORD)

/** Every word of the name appears in the account, possibly inside a longer word. */
const satisfies = (name: string, user: TenantUser) => {
  const have = [...words(user.displayName), ...words(user.mail.split('@')[0] ?? '')]
  const want = words(name)
  if (!want.length) return false
  return want.every((w) => have.some((h) => h === w || h.includes(w)))
}

async function main() {
  // PowerShell's `Set-Content -Encoding utf8` writes a byte-order mark, and `JSON.parse` reports
  // it as an unexpected token at position zero — which reads like a corrupt file rather than an
  // invisible first character.
  const raw = fs.readFileSync(USERS_FILE, 'utf8').replace(/^﻿/, '')
  const users = (JSON.parse(raw) as TenantUser[]).filter((u) => u.mail)

  const { state } = await loadWorkspace(TENANT)
  const people = Object.values(state.model.people ?? {})

  const matched: { id: string; name: string; email: string; roles: string; domain: string }[] = []
  const ambiguous: { name: string; options: string[] }[] = []
  const unmatched: { name: string; roles: string }[] = []

  for (const p of people) {
    const roles = p.roleIds.join(',') || '(none)'
    if (p.email) continue // already has one — never overwritten by a guess
    const hits = users.filter((u) => satisfies(p.name, u))
    if (hits.length === 1) {
      const email = hits[0].mail
      matched.push({ id: p.id, name: p.name, email, roles, domain: email.split('@')[1] ?? '' })
    } else if (hits.length > 1) {
      ambiguous.push({ name: p.name, options: hits.map((h) => h.mail) })
    } else {
      unmatched.push({ name: p.name, roles })
    }
  }

  console.log('')
  console.log(`AXIOMATE — DIRECTORY ADDRESSES   ${APPLY ? '(applying)' : '(dry run)'}`)
  console.log(`${people.length} people, ${users.length} accounts in the tenant`)
  console.log('')
  console.log('MATCHED')
  for (const m of [...matched].sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name))) {
    console.log(`  ${m.name.slice(0, 26).padEnd(28)}${m.email.padEnd(42)}${m.roles}`)
  }
  if (ambiguous.length) {
    console.log('')
    console.log('AMBIGUOUS — left alone, because guessing gives one person another\'s permissions')
    for (const a of ambiguous) console.log(`  ${a.name.padEnd(28)}${a.options.join('  ')}`)
  }
  console.log('')
  console.log('NO ACCOUNT IN THE TENANT — they cannot sign in, so an address would change nothing')
  for (const u of unmatched) console.log(`  ${u.name.padEnd(28)}${u.roles}`)

  /**
   * Domains are worth a look before this is applied. A delivery role on an address outside the
   * firm is not necessarily wrong — partners do delivery — but it is a different statement from
   * the one the evidence made, which only ever said "this person owns work".
   */
  const external = matched.filter((m) => m.domain !== 'axiocloudsolutions.com' && m.roles.includes('FUNCTIONAL'))
  if (external.length) {
    console.log('')
    console.log('WORTH CONFIRMING — a delivery role on an address outside the firm')
    for (const e of external) console.log(`  ${e.name.padEnd(28)}${e.email}`)
  }

  if (!APPLY) {
    console.log('')
    console.log('Nothing changed. Re-run with --apply to write it.')
    return
  }

  const actions: Action[] = matched.map((m) => {
    const p = people.find((x) => x.id === m.id)!
    return {
      t: 'config' as const,
      op: { k: 'upsertPerson' as const, id: p.id, name: p.name, roleIds: p.roleIds, email: m.email },
      now: NOW,
    }
  })
  if (!actions.length) {
    console.log('\nNothing to write.')
    return
  }

  const result = await persistActions(TENANT, ACTOR, actions)
  console.log('')
  console.log(result.ok ? `Applied. ${actions.length} addresses, ${result.audited} audit rows.` : `Refused: ${result.error}`)
  if (!result.ok) process.exitCode = 1
}

main().catch((e) => {
  console.log('Failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})

/*
 * The account list is produced separately rather than fetched here, so that this script needs
 * no directory permissions of its own and can be read for exactly what it writes:
 *
 *   az ad user list --output json > tenant-users.json
 *
 * It is deliberately not committed: it is the firm's whole staff and guest list.
 */
