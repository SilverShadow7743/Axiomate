# Email signature — implementation plan

Follows `docs/plans/2026-09-08-email-signature-design.md` (approved 10 Sep — new `Person.title`/
`Person.phone` fields, a stored editable `OrganizationIdentity.signatureTemplate`, scope across
Compose/Reply/the firm-mailbox route, and the decided template content including the locked
positioning tagline). Ordering: pure data-model and template logic first, provable by a scenario
before any Graph call exists; then the Graph wiring, ordered by blast radius (personal routes
before the firm-mailbox route, which is the one with real commercial consequences and a shared
function four other callers depend on); then the Configuration UI, which depends on nothing else
and could in principle ship first but is sequenced last because seeing the template render
correctly in a real sent message is worth more than seeing it in a textarea.

## Two things the design doc didn't need to settle, found while grounding this plan

Both are implementation-correctness questions, not business judgment calls — resolved here by
reading Microsoft's own Graph API reference (`message: reply`, `message: createReply`) rather than
guessed at:

1. **`POST /me/messages/{id}/reply`'s `comment` field cannot carry the signature.** Graph's own
   docs: *"Specify either a comment or the **body** property of the `message` parameter. Specifying
   both will return an HTTP 400 Bad Request error."* Whether `comment` renders embedded HTML tags
   as HTML or displays them as literal text is undocumented — not worth betting a client-visible
   email on. Graph's own stated alternative — *"create a draft to reply to an existing message and
   send it later"* — is what this plan uses instead: `POST .../createReply` (returns a `201` with
   the full draft `Message`, `body.content` already holding the correctly quoted, threaded original
   in HTML), then `PATCH` that draft's `body` with the signed HTML prepended, then
   `POST .../send`. Slower (three calls instead of one) but unambiguous about content type.
2. **`sendAsMailbox` (`lib/mail.ts`) has five callers, not one.** Grep confirms:
   `app/api/mail/send/route.ts` (the one this design touches), `app/api/workspace/route.ts`
   (a notification), and `lib/db/notifyDrain.ts`/`lib/db/schedule.ts` ×2 (Daily IMS, governance
   pack delivery). The signature must not reach the last three — a report-delivery email is not
   "a person's mail" and has no `session.actor` to resolve a name/title from. `sendAsMailbox` gets
   a new **trailing, optional** `contentType?: 'Text' | 'HTML'` parameter, defaulting to `'Text'`,
   so the four untouched callers are byte-identical to today; only the new call in
   `app/api/mail/send/route.ts` passes `'HTML'`.

## Steps

**1. Data model — `lib/config.ts`, `lib/workspace.ts`.**

- `Person`: add `title?: string` and `phone?: string` right after `email?: string`, same doc-
  comment convention (optional, absent means not recorded, not the same thing as an empty string).
- `OrganizationIdentity`: add `signatureTemplate?: string`. Seed `DEFAULT_ORGANIZATION` with the
  design's decided default:
  ```
  Thanks,
  {{name}}
  {{title}}
  {{org}}
  Engineering Intelligent Enterprises
  {{phone}}
  ```
  (the logo is composed separately, not a `{{}}` token — see step 2).
- `lib/workspace.ts`'s `upsertPerson` `ConfigOp`: add `title?: string; phone?: string`. In the
  reducer arm (`case 'upsertPerson'`), merge both with the **same absent-vs-cleared pattern
  `email` already uses** (`undefined` keeps what was there, `''` clears it) — NOT `career()`'s
  `source: 'stated'` stamping, which is specific to grade/track/developingToward and does not
  apply here.
- `lib/workspace.ts`'s `setOrganization` reducer arm: add `signatureTemplate` to the `unchanged`
  comparison (currently `name`/`shortName`/`description`/`partyCode`/`logoDataUri` only). **This
  is the step's one real trap** — the design's own decision #4 requires the template to be
  editable in Configuration; without this line, an admin who edits ONLY the signature template
  (leaving name/logo/etc. untouched) hits `if (unchanged) return { state }` and the edit silently
  does nothing, with no error and no saved change.

**Verify:** `npx tsc --noEmit`.

**2. `lib/signature.ts` (new, pure) — template fill and HTML escaping.**

```ts
export interface SignatureValues { name: string; title?: string; org: string; phone?: string }

export function buildSignatureHtml(template: string, values: SignatureValues, logoDataUri?: string): string
export function plainTextToHtml(text: string): string
```

- `buildSignatureHtml`: fills `{{name}}`/`{{org}}` always; fills `{{title}}`/`{{phone}}` when
  present, but **when `title` or `phone` is absent, the whole line carrying that placeholder is
  dropped, not rendered blank or as a literal `{{title}}`** — matches the rest of this codebase's
  own "absent means unrecorded, never a visible gap" convention (the same reasoning `grade`/
  `track` already follow), and avoids ~25 people's signatures showing an empty line or raw
  template syntax before anyone has entered a title. Every substituted value is HTML-escaped
  (`&`, `<`, `>`, `"`) before insertion — a person's own name or title is untrusted-enough input
  that it must not be able to break the surrounding markup. The logo, when `logoDataUri` is
  given, is appended as a small `<img>` tag below the text block — composed here, not a
  placeholder, per the design's own reasoning (an image isn't text).
- `plainTextToHtml`: escapes the same four characters, then converts `\n` to `<br>` — this is
  what turns the person's own typed Compose/Reply/firm-route text into safe HTML now that
  `contentType` moves off `'Text'`. Without this, a `<`/`&` typed by a sender (a stray "<3" or
  "Tom & Jerry" in the message body) would either vanish or break the rendered HTML.

**3. New scenarios in `scripts/scenario-validation.ts`.**

- **`SIG1`** — `buildSignatureHtml`: both placeholders present renders both lines; title absent
  drops the title line entirely (not blank, not literal `{{title}}`); phone absent drops the
  phone line; a name containing `<script>` or `&` renders HTML-escaped, not executable/broken;
  the logo `<img>` appears only when `logoDataUri` is passed. `plainTextToHtml`: a body containing
  `<b>not bold</b>` renders as escaped text, not a real bold tag; a two-line body (`\n` in the
  middle) renders with a `<br>` between the lines.
- **`SIG2`** — the config-op side: `upsertPerson` with `title`/`phone` set, then a follow-up
  `upsertPerson` omitting them (unchanged, per the absent-vs-cleared rule) preserves both, then
  one clearing `title` to `''` removes only that field; `setOrganization` with ONLY
  `signatureTemplate` in the patch (name/logo/etc. all omitted) is *not* swallowed by the
  `unchanged` guard — the specific regression step 1 names — proven by asserting the new template
  string is actually stored afterward, not just that the call returned no error.

**Verify:** `npx tsx scripts/scenario-validation.ts` — `SIG1 PASS`, `SIG2 PASS`, scenario count
+2, no regressions.

**4. `lib/personalGraph.ts` — `sendNewMail` and `replyToMessage`.**

- `sendNewMail`: add a `contentType: 'Text' | 'HTML'` parameter (its only caller is about to be
  rewritten in step 5, so no default is needed the way `sendAsMailbox` needs one) — used as
  `body.contentType` in the Graph call, replacing the hardcoded `'Text'`.
- `replyToMessage`: rewritten to the three-call sequence from the finding above. New signature
  `replyToMessage(token, messageId, htmlContent, replyAll)`:
  1. `POST /me/messages/{id}/createReply` (or `createReplyAll` when `replyAll`) → the draft
     `Message`, whose `body.content` already holds the quoted original in HTML.
  2. `PATCH /me/messages/{draftId}` with `{ body: { contentType: 'HTML', content: htmlContent +
     draft.body.content } }` — the caller's signed HTML goes ABOVE what Graph already generated,
     never replacing it, so the quoted thread survives exactly as a normal reply would show it.
  3. `POST /me/messages/{draftId}/send` (no body) to actually send the now-edited draft.

**Verify:** `npx tsc --noEmit`. No scenario coverage for this step — it is a live Graph call
sequence the harness cannot drive, the same limit this session's Graph-touching work has hit
throughout (A2/B's "stops at a live database/route" pattern in the scenario summary). Live
verification is step 8, not this step.

**5. `app/api/mail/compose/route.ts` and `app/api/mail/reply/route.ts`.**

Both routes currently do nothing with workspace state — per their own doc comments, "no workspace
permission applies because nothing here touches workspace data." That becomes untrue: both now
need `state.model.organization` (name, logo, template) and the sender's own `Person` record
(title, phone). Both:

- Call `loadWorkspace(currentTenantId())`, guarded by `databaseConfigured()` — **but on either
  being false, or the load throwing, fall back to sending the PLAIN, unsigned message exactly as
  today rather than failing the request.** A missing signature is a cosmetic loss; refusing to
  send someone's personal email because the app's own database is briefly unreachable would be a
  real regression in a feature this design never touches (personal Graph mail has always worked
  independently of `databaseConfigured()` — see `/api/mail/send`'s own explicit check, which
  exists precisely because THAT route, unlike these two, already depends on the database for the
  client-visible note).
- Resolve `directoryPersonFor(state.model, session.actor)` for `name`/`title`/`phone` (falls back
  to `session.actor.name` with no title/phone if the actor doesn't resolve to a directory person —
  same null-safe posture `ownerLeaveCaveat`/I14 already established for an unresolved name).
- Build `plainTextToHtml(text) + buildSignatureHtml(org.signatureTemplate ?? DEFAULT_ORGANIZATION.signatureTemplate, {...}, org.logoDataUri)`.
- Compose: call `sendNewMail(token, { to, subject, body: htmlBody }, 'HTML')`.
- Reply: call `replyToMessage(token, messageId, htmlBody, replyAll)` (the rewritten step-4
  signature).

**Verify:** `npx tsc --noEmit`, `npm run build`.

**6. `lib/mail.ts` (`sendAsMailbox`) and `app/api/mail/send/route.ts` — the firm-mailbox route.**

- `sendAsMailbox`: add the trailing `contentType: 'Text' | 'HTML' = 'Text'` parameter named in
  the finding above. The body's `body.contentType` uses it; every other line is unchanged.
- `app/api/mail/send/route.ts`: `state` is already loaded here (it needs `state.model` for the
  `mail.send`/`note.add` permission checks). After `sendingMailboxFor` resolves, additionally
  resolve `directoryPersonFor(state.model, session.actor)` and build the signed HTML the same way
  step 5 does.
- **The trap this step exists to name**: `outboundNoteBody`/`alreadySent` (`lib/outbound.ts`) and
  the `addNote` action further down this same route currently read the PLAIN `text` the person
  typed — that is what becomes the client-visible note on the issue record, and what the retry-
  dedupe check compares against. **Both must keep reading the plain, unsigned `text` — never the
  signed HTML body.** Pass the signed HTML only to `sendAsMailbox` itself; every other use of
  `text` in this route (the note body, the dedupe match, the `replayed` response) is untouched.
  Get this backwards and either the issue record's note becomes a wall of HTML markup instead of
  what was actually said to the client, or a legitimate second send with genuinely different text
  risks being compared against a signature-inflated string instead of the clean words.

**Verify:** `npx tsc --noEmit`, `npm run build`.

**7. Configuration UI — `components/ConfigWorkspace.tsx`.**

- "This workspace" section: a new `<textarea>` for `signatureTemplate`, positioned beside where
  `description`/`logoDataUri` are already edited, same `onBlur`-dispatches-`setOrganization`
  pattern every other field in that section already uses
  (`onConfig({ k: 'setOrganization', patch: { signatureTemplate: e.target.value } })`). A short
  static line beneath it names the four placeholders (`{{name}}`, `{{title}}`, `{{org}}`,
  `{{phone}}`) and notes the logo is added automatically — reference text, not itself editable.
- People table: two new inline-editable `<td>` cells, "Title" and "Phone", structural copies of
  the existing "Email" cell (`components/ConfigWorkspace.tsx` around line 912) — a plain text
  `<input>`, `onBlur` dispatching `upsertPerson` with the changed field, reverting the input's
  displayed value on refusal exactly as the email cell does.

**Verify:** `npx tsc --noEmit`, `npm run build`, `npx eslint components/ConfigWorkspace.tsx`.

**8. Live verification (last — Graph itself cannot be driven by this harness).**

- Set a title and phone for the signed-in test person in Configuration → Roles & people; confirm
  the signature-template textarea shows the seeded default and can be edited and saved (re-open
  Configuration after a page reload to confirm the edit actually persisted — this is exactly the
  case `SIG2` proves at the reducer level, but a live check closes the loop through the real UI).
- Send a real Compose message to a safe test address (or the signed-in person's own address);
  open the received message and confirm: the signature renders below the typed text with correct
  name/title/org/tagline/phone/logo, no literal `{{}}` anywhere, and the message is genuinely
  HTML (not tags-as-text).
- Reply to a real existing message; confirm the quoted original thread is intact below the new
  text and signature, exactly as an ordinary Outlook reply would show it.
- If a safe-to-use test issue with a real intake mailbox exists: send once through
  `POST /api/mail/send`; confirm the signature appears in the actual delivered email AND that the
  note recorded on the issue shows the plain text only, no HTML/signature markup.

## Commits

**Commit 1 — steps 1–3.** Data model, the pure signature module, both scenarios. Provable
end-to-end without a single Graph call existing yet.

**Commit 2 — steps 4–6.** The Graph wiring across all three send paths, bundled together: the
reply rewrite (step 4) has no caller until step 5 wires it in, and splitting the firm-mailbox
route (step 6) into its own commit would leave two of the three paths signed and one not, with no
meaningful intermediate state to ship. **This is the step carrying the most regression risk in
the whole plan** — not because the new code is complex, but because `sendAsMailbox`'s
`contentType` parameter is shared by five call sites, three of them automated report/notification
delivery running unattended on a schedule (`lib/db/schedule.ts`'s Daily IMS and governance pack
sends). A wrong default, or a change to `sendAsMailbox`'s existing parameters instead of a purely
additive trailing one, would silently corrupt or break report delivery for every client — the
kind of failure nobody sees until a report simply stops arriving. Diffing `lib/mail.ts` against
its pre-change version before this commit, specifically confirming the four untouched call sites
compile with no changes required, is the concrete check against this.

**Commit 3 — step 7.** The Configuration UI — independently useful and independently verifiable
(an admin can see and edit the template, and see the new Title/Phone columns, even before any
live send is checked), so it stands alone rather than riding in with the Graph wiring.

## What would send this back to the design

- **If a real sent Reply loses the quoted thread, or double-quotes it.** Would mean the
  `createReply`-draft `body.content` does not already hold what step 4 assumes it holds — caught
  only at live verification (step 8), since nothing here can drive Graph. Not a reason to reopen
  the design's own decisions, but a reason to revisit the mechanics named in the finding at the
  top of this plan.
- **If any live-verified signature shows a literal `{{title}}` or `{{phone}}` rather than an
  omitted line**, for a person with no title/phone recorded — means step 2's omission behavior
  has a bug, and is disqualifying on sight, not a nitpick to fix later.
- **If Daily IMS or the governance pack stop arriving after commit 2 ships** — means the
  `sendAsMailbox` change broke one of its other four callers despite being additive-only; revert
  commit 2 and re-examine rather than patching forward, since the blast radius (every client's
  scheduled report) is too wide to debug live.
