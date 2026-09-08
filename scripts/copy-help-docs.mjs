#!/usr/bin/env node
// Writes the curated "why this works this way" reasoning into public/help/<slug>.md, so it
// reaches the deploy package — docs/ itself never does (see .github/workflows/deploy.yml's
// "Assemble the deployment package" step, which never copies docs/). Curated, not crawled: this
// allowlist is an editorial choice (docs/plans/2026-09-08-why-this-works-design.md), not a scan
// of docs/plans/.
//
// A 'comment' entry reads a source .ts file's leading /** */ header rather than forking a
// second copy of that reasoning into docs/plans/ — the code comment stays the one source of
// truth, so it cannot drift the way a duplicated doc would.
//
// Runs as `predev`/`prebuild` (package.json), same lifecycle-hook shape already used for the
// scripts under scripts/ that other npm scripts depend on.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'public', 'help')

const CURATED = [
  {
    slug: 'first-run',
    title: 'Why "Your first week here" looks the way it does',
    source: 'docs/plans/2026-08-31-first-run-design.md',
    kind: 'doc',
  },
  {
    slug: 'admin-first-run',
    title: 'Why the setup guide is a computed checklist, not a course',
    source: 'docs/plans/2026-09-08-admin-first-run-design.md',
    kind: 'doc',
  },
  {
    slug: 'goals',
    title: 'Why nobody types the progress',
    source: 'lib/goals.ts',
    kind: 'comment',
  },
  {
    slug: 'automation-actions',
    title: 'Why an automation rule cannot do anything a person could not',
    source: 'docs/plans/2026-09-08-automation-actions-design.md',
    kind: 'doc',
  },
  {
    slug: 'skills-candidates',
    title: 'Why this never ranks a best person',
    source: 'lib/skills.ts',
    kind: 'comment',
  },
  {
    slug: 'portfolio-concerns',
    title: 'Why Portfolio has no health score',
    source: 'lib/portfolio.ts',
    kind: 'comment',
  },
]

function extractHeaderComment(source, file) {
  // The first block comment in the file, not necessarily the first line: imports come first
  // (lib/goals.ts, lib/skills.ts, lib/portfolio.ts all import before their header comment).
  const match = source.match(/\/\*\*([\s\S]*?)\*\//)
  if (!match) throw new Error(`${file}: no /** */ header comment found`)
  return match[1]
    .split('\n')
    .map((line) => line.replace(/^[ \t]*\*[ \t]?/, ''))
    .join('\n')
    .trim()
}

rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

const manifest = []
for (const entry of CURATED) {
  const abs = path.join(ROOT, entry.source)
  if (!existsSync(abs)) throw new Error(`copy-help-docs: ${entry.source} does not exist`)
  const raw = readFileSync(abs, 'utf8')
  const body = entry.kind === 'comment' ? extractHeaderComment(raw, entry.source) : raw
  writeFileSync(path.join(OUT_DIR, `${entry.slug}.md`), body, 'utf8')
  manifest.push({ slug: entry.slug, title: entry.title, source: entry.source })
}
writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

console.log(`copy-help-docs: wrote ${CURATED.length} doc(s) to public/help/`)
