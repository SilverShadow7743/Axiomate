# "Why this works this way" — surfacing design docs in the app, not writing new content

**Status: draft, 8 September 2026.** Brainstormed from a comparison against Hive University
(`university.hive.com` — a separate LMS site: video courses, webinars, an Admin Learning
Track, and a "Center of Excellence" of best-practice content), refined at Nishant's request
into something that could actually be native to Axiomate rather than a content-production
project. Not built. Two open questions for Nishant before this goes further, at the end.

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

## Open questions for Nishant

1. **Markdown rendering: add a dependency, or plain text for v1?**
2. **Which docs make the first curated list?** The five named above are candidates from this
   session's own work, not a decision — Nishant knows which explanations actually get asked for.
