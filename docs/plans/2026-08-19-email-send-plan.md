# Email send — implementation plan

Follows `docs/plans/2026-08-19-email-send-design.md` (approved 19 Aug 2026). Ordering
principle: everything provable without a mail server first — resolution, composition, the
permission gate — and the one unprovable-until-live piece (the Graph call plus the tenant
grant and access policy) last, with the round-trip through intake as its proof.

The design's governing constraints, quoted: *"the sending identity is the receiving one"*;
*"people only"*; *"a failed send records nothing"*; *"app-only Mail.Send without the policy is
send-as-anyone-in-the-tenant"*.

## Steps

**1. `lib/outbound.ts` (new) — the pure half.**
`sendingMailboxFor(state, issueId)`: walk `scopeChainOf(state, issue.parentId)`
(lib/workspace.ts:664) from the issue upward; the first enabled `IntakeMailbox` whose
`scopeId` appears in the chain wins (nearest first); none → a stated refusal string.
`recipientOf(issue)`: parse `raisedBy` in the "Name <email>" shape both intake and forms
write; a bare valid email passes; anything else → null (the compose does not open).
`subjectFor(issue)`: `RE: <subject> [<id>]` — the reference is what threads the reply back.
*Verify:* `npx tsc --noEmit`; scenarios in step 2.

**2. Scenario MS1 — `scripts/scenario-validation.ts` (CRLF; python script file).**
Nearest-mailbox resolution (a mailbox on the engagement beats one on the client; none →
refusal names the gap); recipient parsing (angle-bracket claim, bare email, and a
display-name-only claim returning null); the subject carrying the id.
*Verify:* `npm run validate:scenarios` — MS1 PASS, nothing regresses.

**3. Permission + capability wiring — `lib/access.ts`, `lib/capabilities.ts`.**
`{ key: 'mail.send', label: 'Write to clients', what: 'Send email from an engagement's
mailbox, recorded on the record.' }` in `PERMISSIONS` (lib/access.ts:49); grant in
`DEFAULT_GRANTS` (lib/access.ts:219) to the roles that hold `work.close` today — closing and
client contact travel together in this firm. 20th capability in `CAPABILITIES` with
`needs: ['mail.send']`. The capability count assertion in the scenario suite moves 19 → 20.
KNOWN consequence, verified not silently suffered: the deployed workspace's stored roles will
NOT hold the key; the Capabilities screen must show `lostInMerge` naming it. Checklist
section 20 step 1 is exactly that observation, then granting it on the Permissions screen.
*Verify:* `npx tsc --noEmit`; `npm run validate:scenarios` (the count assertion).

**4. The endpoint — `app/api/mail/send/route.ts` (new).
THE STEP CARRYING THE MOST REGRESSION RISK** — the third door, and this one WRITES OUTWARD:
its failure mode is an email a client was not meant to get, sent as the firm. Guards, in
order: session required and verified (no token path — people only); `can(model, actor,
'mail.send')` refused with the gate's own words; the issue exists and is not archived;
`recipientOf` non-null; `sendingMailboxFor` resolves. Only then the Graph call: app-only
token (the `AXIOMATE_ENTRA_*` credential set the document store already uses, cached the same
way), `POST /users/{mailbox}/sendMail` with subject from `subjectFor`, the recipient, and the
person's text as plain-text body. On 2xx: dispatch `addNote` (pinned, Client Communication,
carrying recipient + subject + body) through `persistActions` with the PERSON as actor — the
send is theirs, not a machine's. On Graph refusal: one honest sentence to the caller, the
full error to the server log, nothing written.
*Verify:* `npx tsc --noEmit && npm run build`. The Graph path is live-only by design.

**5. The compose — issue detail panel (components/DetailPanel.tsx or the panel component the
Overview tab renders), plus IssueWorkspace wiring.**
A "Reply to client" affordance visible when `recipientOf` answers and the session may
`mail.send` — the same both-halves rule as everywhere: the button hides without the grant AND
the endpoint refuses without it. The compose shows the resolved From (the mailbox), To (the
claim), the fixed subject, a body field, Send. Success closes and the note appears in Notes;
failure shows the sentence and keeps the typed body — a client email is not something to
retype.
*Verify:* `npm run build`; the browser half in step 7.

**6. The tenant grant — operator-confirmed, then mine.**
Add `Mail.Send` app role to the registration (the appRoleAssignment POST that worked for
`Sites.ReadWrite.All` — `az ad app permission admin-consent` proved unreliable); then the
Exchange Application Access Policy restricting the app to `OAPILCatalyst@` via
`New-ApplicationAccessPolicy -AppId 9d46ddc0-… -PolicyScopeGroupId <mail-enabled group or
the mailbox>` over the token-based Exchange session (memory: axiomate-azure-cli-access).
Verify the policy with `Test-ApplicationAccessPolicy` for the shared mailbox (Granted) and
for another mailbox (Denied) BEFORE the first send.
*Verify:* `Test-ApplicationAccessPolicy` both ways — the Denied half is the point.

**7. Checklist section 20, sweep, deploy, and the live round-trip.**
Section 20: observe `lostInMerge` on Capabilities, grant `mail.send`, open an issue with a
claim (OAPIL-146), send one real message to the operator's own address, confirm the pinned
note, then reply to that email and watch intake file the reply against OAPIL with the
reference in its subject. Sweep + release as before.

## Details most likely to be got wrong

- **Nearest mailbox means nearest**: the chain walks issue → module → project → engagement →
  client; iterate the chain in order and take the FIRST mailbox match, not any match.
- **The endpoint has no token path.** Intake's bearer token must not open this door; a
  machine that can send client mail is the thing the design refuses.
- **The note is dispatched as the person**, not INTAKE_ACTOR — the send is theirs.
- **Keep the typed body on failure** — losing a client email to a 503 is the compose's one
  unforgivable bug.
- **`Test-ApplicationAccessPolicy` Denied case before the first send** — the policy silently
  not applying leaves send-as-anyone live.
- **The capability-count assertion** in the suite must move to 20 in the same commit as the
  catalogue entry, or CI fails on the count.
- Angle-bracket parsing: `"Name <a@b.c>"`, `"a@b.c"` both valid; reuse the email regex the
  form endpoint uses.

## Commits

Steps 1–2 together. Step 3 alone (the permission is its own reviewable change). Steps 4–5
together (door and handle). Step 6 is infrastructure, not a commit. Step 7 with the checklist.

## What would send the design back

- The Application Access Policy cannot scope to a single shared mailbox in this tenant
  (surfaces in step 6) — the design's least-privilege posture fails and sending identity
  must be rethought, not shipped broad.
- `raisedBy` claims turn out too dirty to parse for real records (surfaces in step 7 on live
  data) — the compose would need a recipient field, which reopens "who may be written to".
- The panel has no room for a compose without crowding the tabs (surfaces in step 5) — a
  drawer-level rethink, not a squeeze.
