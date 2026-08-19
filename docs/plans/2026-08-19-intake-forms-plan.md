# Intake forms — implementation plan

Follows `docs/plans/2026-08-19-intake-forms-design.md` (approved 19 Aug 2026). Ordering
principle: the shareable half of classification is extracted and proven before any endpoint
exists, the config plumbing is compile-time exhaustive before a token can be minted, and the
page — the browser part — comes last with the production submission after it.

The design's governing constraints, quoted: *"capture never discloses"*; *"an unknown token
and a disabled one produce the same refusal, with nothing revealed"*; *"feeds the existing
pipeline rather than growing a second one"*.

## Steps

**1. Refactor `lib/intake.ts` — extract the shareable half of `classify`.**
`classify` (lib/intake.ts:228) is two halves: mailbox lookup (lines ~236–259) and everything
after — rule application, severity/type guessing, draft assembly. Extract the second half as
`draftFor(scopeId: string, message: InboundMessage, model: OperatingModel, stated?: { severity:
Severity }): IntakeDraft`, and make `classify` call it, behaviour identical. Add
`classifyForm(form: IntakeForm, message: InboundMessage, model: OperatingModel)` mirroring
`classify`'s refusal shape: disabled and missing-scope forms refuse; a stated urgency becomes
the severity with confidence `'stated'` (the client said it — same vocabulary as a rule saying
it). Also `urgencyToSeverity('urgent'|'normal'|'low')`.
*Verify:* `npx tsc --noEmit`; `npm run validate:scenarios` — scenario A (the mail pipeline)
must still PASS unchanged, which is the proof the refactor moved nothing.

**2. Scenario IF1 — `scripts/scenario-validation.ts` (CRLF; python-with-CRLF insertion).**
Drives `classifyForm` pure: a disabled form refuses; urgency 'urgent' lands severity High with
confidence stated; routing rules still apply to form text (a keyword rule assigns its owner);
subject falls back to the first line when empty.
*Verify:* `npm run validate:scenarios` — IF1 PASS, nothing regresses.

**3. Config plumbing — `lib/config.ts`, `lib/workspace.ts`, `lib/actionShape.ts`.**
`IntakeForm { id, name, scopeId, enabled, token }` in `lib/config.ts` beside `IntakeMailbox`;
`intakeForms: IntakeForm[]` on `OperatingModel`, empty in the seed, **explicit `mergeModel`
line** (`intakeForms: stored.intakeForms ?? seed.intakeForms`). `ConfigOp` gains
`upsertIntakeForm` / `deleteIntakeForm` beside `upsertIntake` (lib/workspace.ts:1113); reducer
arms beside `case 'upsertIntake'` (~line 5977): name required, `canParent('issue', kindOf(…))`
at write time, and **the token is minted in the reducer on creation** (`FORM_${seq}_` plus
random suffix via the action's `now`-seeded id — see gotchas: no `Math.random` in the reducer;
the token comes from the ACTION, minted by the caller screen with `crypto.randomUUID()`, and
the reducer only refuses a blank one on create). Register both kinds in `CONFIG_OPS`
(lib/actionShape.ts:150 area).
*Verify:* `npx tsc --noEmit`; scenario IF2: upsert refuses a scope that cannot hold an issue;
a created form carries its token; the token never changes on later patches unless explicitly
sent.

**4. The endpoint — `app/api/intake/form/route.ts` (new).
THE STEP CARRYING THE MOST REGRESSION RISK.**
Not because it touches existing paths — it is new — but because it is the second door that
creates records from the internet, and its failure mode is silent abuse rather than a broken
screen. POST body: `{ token, name, email, subject, description, urgency }`. Resolve the token
against `model.intakeForms` — unknown and disabled produce the SAME 404-shaped refusal with a
constant body, so probing reveals nothing. Validate fields (name/subject/description
non-empty, email matches the same regex `upsertIntake` uses, urgency one of three). Build the
`InboundMessage` with `from` = `"name <email>"`, server-minted `messageId`
(`form-${crypto.randomUUID()}`), then run the EXISTING second half: duplicate check, `classifyForm`,
`persistActions` with `INTAKE_ACTOR`, provenance note ("arrived via the {form.name} form" —
extend `provenanceNote` or add a form variant), assignments. Response: `{ ok, reference }`
where reference is the issue's display id — the one disclosed fact.
*Verify:* `npx tsc --noEmit && npm run build`; then curl against a local `next start` is NOT
attempted (needs the database) — the production submission in step 6 is the live proof, and
IF1/IF2 already prove the logic the endpoint composes.

**5. The page — `app/intake/form/[token]/page.tsx` (new) + CSS.**
A server component rendering ONLY the form — it does not load the workspace, so there is
nothing to leak; the token is not validated at render time (that would make the page a token
oracle) — validation happens on submit. Fields per the design; urgency as three plain radio
options; a client component handles submit → the endpoint → shows "Received — reference X" or
the refusal. Must render for signed-out visitors: check `middleware`/auth exclusions the same
way `/api/intake` and `/signin` are excluded, and add `/intake/form` to them.
*Verify:* `npm run build`; anonymous `curl -s .../intake/form/anything | grep` shows the form
markup and no workspace strings (assert the absence of "AXIOCLOUD" in the HTML).

**6. Configuration UI, checklist 18, sweep, deploy, live submission.**
Routing & intake section gains a Forms block: list (name, URL with the token, scope, enabled,
what it last raised is NOT tracked — forms have no lastRaisedOn), add-form row minting the
token with `crypto.randomUUID()` client-side. Checklist section 18: create a form for OAPIL
Engagement, open its URL in a private window (signed out), submit a real test entry, confirm
the reference comes back, the issue files under OAPIL with the provenance note naming the
form, and a second identical submit still creates (different messageId — forms have no
sender id; state this in the checklist as expected, not a bug). Sweep + release as phases 1–2.

## Details most likely to be got wrong

- **No `Math.random`/`crypto` in the reducer.** The token is minted by the CALLER (the config
  screen / a script) and travels in the action; the reducer only refuses a blank token on
  create. Minting it in the reducer would break replay/idempotency.
- **The page must not validate the token at render time** — that turns a public page into a
  token-probing oracle with a fast signal. Render the form for any path; refuse at submit.
- **Unknown and disabled tokens must be indistinguishable** in status, body and timing shape.
- **The auth exclusion list**: `/intake/form` must render signed-out or the whole feature is
  dead on arrival; conversely nothing else may ride in on that exclusion — scope it to the
  exact path prefix.
- **`draftFor` must be called by `classify` after the refactor** — two copies of the guessing
  logic is how the mail and form paths drift.
- **Email validation reuses `upsertIntake`'s regex** rather than a new one.
- `scripts/scenario-validation.ts` is CRLF; `lib/*.ts` LF. `file` before committing. Long
  python edits go via a script file, not a heredoc — two heredocs were eaten by the shell
  yesterday at ~10KB.

## Commits

Steps 1–2 together (refactor + its proof). Step 3 alone. Steps 4–5 together (endpoint and page
are meaningless in halves). Step 6 with the checklist.

## What would send the design back

- The refactor shows `classify`'s halves are entangled (severity guessing depending on the
  mailbox, say) — surfaces in step 1; would mean the "same pipeline" premise needs a
  different seam.
- Rendering the form without validating the token proves unacceptable in practice (confusing
  dead-URL submissions) — surfaces in step 6's live test; the fix (render-time validation)
  reopens the oracle question, so it is a design decision, not a patch.
- The auth middleware cannot exclude a path prefix without excluding more than intended —
  surfaces in step 5; would mean the page belongs on a separate host/subdomain, which is an
  infrastructure design change.
