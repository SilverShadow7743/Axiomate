#!/usr/bin/env node
// Contract checker for docs/artifacts. Dependency-free by design so the standing gate can run it
// anywhere. Validates every artifact against .claude/contracts/*.schema.json and the rules in
// .claude/contracts/registry.json. See .claude/contracts/README.md for the rule list and
// docs/plans/2026-09-05-agentic-operating-model-design.md Part 6 for why.
//
// Usage: node scripts/contract-check.mjs [--dir docs/artifacts]
// Exit 0: every artifact valid. Exit 1: failures listed, one line per rule broken.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

const argv = process.argv.slice(2)
const dirFlag = argv.indexOf('--dir')
const ARTIFACTS = dirFlag >= 0 ? argv[dirFlag + 1] : 'docs/artifacts'
const CONTRACTS = '.claude/contracts'

// ---------------------------------------------------------------------------------------------
// A small JSON Schema draft-07 subset: type, required, properties, enum, items, minItems,
// minLength, minimum, pattern. Enough for the contracts here; swap for ajv without touching a
// schema if the subset ever stops being enough.
// ---------------------------------------------------------------------------------------------
function typeOf(v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (Number.isInteger(v)) return 'integer'
  return typeof v
}
function typeMatches(want, v) {
  const t = typeOf(v)
  if (want === 'number') return t === 'number' || t === 'integer'
  return want === t
}
function validate(schema, value, path, out) {
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((t) => typeMatches(t, value))) {
      out.push(`${path}: expected ${types.join('|')}, got ${typeOf(value)}`)
      return
    }
  }
  if (value === null) return
  if (schema.enum && !schema.enum.includes(value)) out.push(`${path}: "${value}" not in [${schema.enum.join(', ')}]`)
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) out.push(`${path}: "${value}" does not match ${schema.pattern}`)
  if (schema.minLength !== undefined && typeof value === 'string' && value.length < schema.minLength) out.push(`${path}: shorter than ${schema.minLength}`)
  if (schema.minimum !== undefined && typeof value === 'number' && value < schema.minimum) out.push(`${path}: ${value} below minimum ${schema.minimum}`)
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) out.push(`${path}: needs at least ${schema.minItems} item(s)`)
    if (schema.items) value.forEach((item, i) => validate(schema.items, item, `${path}[${i}]`, out))
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required || []) if (!(key in value)) out.push(`${path}.${key}: required`)
    for (const [key, sub] of Object.entries(schema.properties || {})) if (key in value) validate(sub, value[key], `${path}.${key}`, out)
  }
}

// ---------------------------------------------------------------------------------------------
function loadJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'))
}

const registry = loadJson(join(CONTRACTS, 'registry.json'))
const envelope = loadJson(join(CONTRACTS, 'envelope.schema.json'))
const agentsByName = new Map(registry.agents.map((a) => [a.name, a]))
const failures = []
const fail = (file, rule, msg) => failures.push(`${file}  [${rule}]  ${msg}`)

if (!existsSync(ARTIFACTS)) {
  console.log(`contract-check: ${ARTIFACTS} does not exist — 0 artifacts, nothing to check`)
  process.exit(0)
}

const files = readdirSync(ARTIFACTS).filter((f) => f.endsWith('.json')).sort()
const artifacts = new Map()

// First pass: parse, envelope, filename.
for (const file of files) {
  let art
  try {
    art = loadJson(join(ARTIFACTS, file))
  } catch (e) {
    fail(file, 'parse', e.message)
    continue
  }
  const errs = []
  validate(envelope, art, '$', errs)
  errs.forEach((e) => fail(file, 'envelope', e))
  if (errs.length) continue

  const expectedName = `${art.id}.${art.kind}.json`
  if (basename(file) !== expectedName) fail(file, 'filename', `expected ${expectedName}`)
  if (artifacts.has(art.id)) fail(file, 'id', `duplicate id ${art.id}`)
  artifacts.set(art.id, { art, file })
}

// Second pass: body schema, traces, producer, status, approvals, plan rules.
for (const { art, file } of artifacts.values()) {
  const kindSchemaPath = join(CONTRACTS, `${art.kind}.schema.json`)
  if (!existsSync(kindSchemaPath)) {
    fail(file, 'kind', `no schema for kind ${art.kind}`)
    continue
  }
  const errs = []
  validate(loadJson(kindSchemaPath), art.body, '$.body', errs)
  errs.forEach((e) => fail(file, 'body', e))

  // Rule 2: traces exist. A live artifact (draft or proposed) may not trace a superseded one —
  // it should retarget to the successor. A finished one (approved, final, rejected, superseded)
  // keeps its traces as history; rewriting them would be editing an approved record.
  const live = art.status === 'draft' || art.status === 'proposed'
  for (const t of art.traces) {
    const target = artifacts.get(t)
    if (!target) fail(file, 'trace', `${t} does not exist`)
    else if (live && target.art.status === 'superseded') fail(file, 'trace', `${t} is superseded; retarget to its successor`)
  }
  if (art.supersedes && !artifacts.has(art.supersedes)) fail(file, 'supersedes', `${art.supersedes} does not exist`)

  // Rule 3: producer registered and allowed to produce this kind.
  const producer = agentsByName.get(art.producer.agent)
  if (!producer) fail(file, 'producer', `${art.producer.agent} is not in registry.json`)
  else if (!producer.produces.includes(art.kind)) fail(file, 'producer', `${art.producer.agent} is not registered to produce ${art.kind}`)

  // Rule 4 and 5: status by kind, approvals by role, approver is a person.
  const isEvidence = registry.evidenceKinds.includes(art.kind)
  if (isEvidence) {
    if (['proposed', 'approved', 'rejected'].includes(art.status)) fail(file, 'status', `${art.kind} is an evidence kind and cannot be ${art.status}`)
  } else {
    if (art.status === 'final') fail(file, 'status', `${art.kind} is a gated kind; use approved, not final`)
    if (art.status === 'approved') {
      const allowed = registry.gates[art.kind] || []
      const ok = art.approvals.some((a) => allowed.includes(a.role))
      if (!ok) fail(file, 'approval', `approved ${art.kind} needs an approval with role in [${allowed.join(', ')}]`)
    }
  }
  for (const a of art.approvals) {
    if (agentsByName.has(a.by)) fail(file, 'approval', `approver "${a.by}" is a registered agent; approvals come from people`)
  }

  // Rule 6: implementation plans — protected paths need the architect; owns lists disjoint.
  if (art.kind === 'implementation-plan' && !errs.length) {
    const b = art.body
    const declaredProtected = b.protected_paths_touched.length > 0
    const ownsProtected = b.workstreams.flatMap((w) => w.owns).filter((p) => registry.protectedPaths.some((pp) => p.startsWith(pp)))
    for (const p of ownsProtected) if (!b.protected_paths_touched.includes(p)) fail(file, 'plan', `${p} is protected but not declared in protected_paths_touched`)
    if ((declaredProtected || b.migration) && art.status === 'approved' && !art.approvals.some((a) => a.role === 'architect')) {
      fail(file, 'plan', 'touches a protected path or migration: approved status needs the architect role')
    }
    const seen = new Map()
    for (const w of b.workstreams) for (const p of w.owns) {
      if (seen.has(p) && seen.get(p) !== w.name) fail(file, 'plan', `${p} owned by both ${seen.get(p)} and ${w.name}`)
      seen.set(p, w.name)
    }
    const names = new Set(b.workstreams.map((w) => w.name))
    for (const s of b.steps) if (!names.has(s.workstream)) fail(file, 'plan', `step ${s.n} names unknown workstream ${s.workstream}`)
    if (!b.steps.some((s) => s.n === b.highest_regression_risk_step)) fail(file, 'plan', `highest_regression_risk_step ${b.highest_regression_risk_step} is not a step`)
  }
}

if (failures.length) {
  console.error(`contract-check: ${failures.length} failure(s) across ${artifacts.size} artifact(s)`)
  for (const f of failures) console.error('  ' + f)
  process.exit(1)
}
console.log(`contract-check: ${artifacts.size} artifact(s) valid`)
