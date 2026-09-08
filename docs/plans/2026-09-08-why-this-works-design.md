# "Why this works this way" — surfacing design docs in the app, not writing new content

**Status: built, 8 September 2026.** Brainstormed from a comparison against Hive University
(`university.hive.com` — a separate LMS site: video courses, webinars, an Admin Learning
Track, and a "Center of Excellence" of best-practice content), refined at Nishant's request
into something that could actually be native to Axiomate rather than a content-production
project. Both open questions below are resolved: markdown rendering (`marked`), and the six
docs named in the "First curation pass" section, taken as the actual list rather than as
candidates.

**One addition beyond the draft.** Three of the six named sources — the Goals reasoning, the
skills/`candidatesFor` module note, and `lib/portfolio.ts`'s "name the concerns, count them" —
are `lib/*.ts` header comments, not `docs/plans/*.md` files. Rather than fork a second, static
copy of that reasoning into a new doc (which would drift from the comment the way
`AccessPolicy.grants`/`DEFAULT_AUTOMATION_RULES` already showed a stored snapshot can),
`scripts/copy-help-docs.mjs` reads the file's leading `/** */` block directly for those three,
so the code comment stays the one source of truth. The other three curated entries copy their
`docs/plans/*.md` file whole, unchanged from the shape this doc proposed.

**Build summary:**
- `scripts/copy-help-docs.mjs` — the curated allowlist (six entries: doc-file or ts-comment,
  slug, title, source path), writes `public/help/<slug>.md` + a `manifest.json`. Wired as
  `predev`/`prebuild` in `package.json` (runs before every `next dev`/`next build`, local and
  CI), so `docs/` still never ships — only the six copies do.
- `public/help/` is gitignored (generated, like `data/validation-report.html`).
- `components/WhyThisWorks.tsx` — the link + modal. Fetches `/help/<slug>.md` client-side,
  renders via `marked` (new dependency — the "add a small markdown renderer" option, chosen
  over plain text), inside the same `.modal`/`.modal-scrim`/`useOverlay` shape every other
  dialog in this codebase uses. Content is this repository's own, not user input, so
  `dangerouslySetInnerHTML` carries no injection risk here.
- Wired onto all six named screens: `FirstRunCard` (`first-run`), `AdminFirstRunCard`
  (`admin-first-run`), Configuration → Goals (`goals`), Configuration → Automation
  (`automation-actions`), Configuration → Skills (`skills-candidates`), `PortfolioPanel`
  (`portfolio-concerns`) — each a `link-btn` beside the screen's own heading, per this doc's
  "one small affordance per curated screen" shape.
- No scenario added: this is rendering only, with no reducer, action, or wire-shape change
  behind it — nothing the scenario harness's event/condition/action model tests.
- Verified: `tsc --noEmit`, full scenario suite (253 scenarios, no PASS lost), `npm run build`
  (prebuild step confirmed writing the six files), `npm run audit:tenancy`.

## Why not build a Hive University clone

Hive University is video and webinar production — a different kind of work than anything
else in this codebase, and not something a code change produces. Most of the *job* it does for
an admin — get oriented, learn the product, know what to do next — is already solved here in a
different, arguably more honest shape: `AdminFirstRunCard` (I6) is a computed checklist, not a
course, and can't go stale the way a recorded video does; every Configuration screen already
carries real explanatory prose in place (Goals: *"There is nowhere to type progress. That is
deliberate..."*) rather than sending someone to a separate page to learn the same thing.

One piece has no equivalent: Hive's "Center of Excellence" — written best-practice guidance,
not a UI feature. That stays out of scope here entirely; it is Axiocloud's own methodology to
write if it wants to, not something this proposes building.

## What's genuinely native: the reasoning already exists, just not shipped

This codebase writes something Hive's course library doesn't have an equivalent of: a real,
dated design doc for nearly every feature, each stating actual reasoning — not "click here to
do X" but *why* it works this way, and what alternative was rejected and for what reason. Two
dozen of these got written or read in this session alone. They are the same source of truth
that governs the code, kept current by the same discipline that keeps the code current — which
is the property a recorded video structurally cannot have.

**The gap is real, though: `docs/` is not shipped.** Checked against
`.github/workflows/deploy.yml`'s own packaging step — the deployed zip is `.next/standalone` +
`public` + `.next/static` + `data`. `docs/plans/*.md` never leaves the repo. So today this
reasoning is real, current, and completely invisible to anyone using the live product — the
opposite problem from Hive's (content that's produced but disconnected from the product isn't
the failure mode here; content that's *attached* to the product but never reaches it is).

## Shape

**Curated, not crawled.** A small, hand-picked allowlist — which doc, which screen — not an
automatic scan of `docs/plans/`. The folder holds ~80 documents; most are infrastructure,
migration notes, or superseded proposals nobody using the product should be reading mid-task.
Deciding which ones are worth surfacing is an editorial call only Nishant can make, the same way
choosing which Hive courses to watch first is the user's call, not the platform's.

**Shipped as a build step, not a database.** A small script copies the allowlisted files into
`public/help/<slug>.md` at build time (mirrors the existing `data/` copy step in the deploy
workflow's packaging, same shape, one more folder). The source of truth stays
`docs/plans/*.md`, edited the same way it already is — nothing new to keep in sync by hand,
since the copy step runs every deploy.

**One small affordance per curated screen**, not a global reference section — a "Why this works
this way" link near the screen's own heading, opening the copied doc. Reusing the exact
principle `AdminFirstRunCard` and `cfg-note` prose already apply: attached to the thing it
explains, not filed somewhere a person has to already know to look.

**Rendering — an open question, not decided here.** No markdown-rendering dependency exists
in this codebase today (checked `package.json`). Two honest options: add a small markdown
renderer (a new dependency, however small, is a real decision this doc shouldn't make
unilaterally), or render as plain preformatted text — these docs are written in restrained
markdown (headers, bold, code spans, bullet lists) and are close to readable as plain text
already, at the cost of losing the visual structure. Nishant's call, not assumed here.

## First curation pass — a starting list, not a commitment

Named as *candidates*, since the actual choice is Nishant's: `2026-08-31-first-run-design.md`
(the "not more UI" reasoning, attached to My work), `2026-09-08-admin-first-run-design.md`
(attached to the same card's admin variant), the Goals design (attached to Configuration →
Goals), the automation design (attached to Configuration → Automation), the skills/`candidatesFor`
module note (attached to a Skills tab or the Skills config screen), `lib/portfolio.ts`'s "name
the concerns, count them" reasoning (attached to Portfolio). Five or six to start, not eighty.

## What stays out

Search over the corpus (a later, separate idea if this proves worth having); the full
`docs/plans/` folder exposed wholesale; anything requiring new writing beyond what already
exists; the Center of Excellence content itself.

## What would send this back

If the curated docs read as inside-baseball to an actual user — written for a future developer
reading the code, not for someone using the product — that is real signal the source material
needs a lighter, user-facing rewrite before shipping, not that the shipping mechanism was wrong.
Surfaces the first time somebody actually reads one of these in the app and it doesn't land.

## Open questions for Nishant — resolved 8 September 2026

1. **Markdown rendering: add a dependency, or plain text for v1?** Add a dependency (`marked`).
2. **Which docs make the first curated list?** The six named above, taken as-is.
