# Client-safe visibility boundary — implementation plan

Follows `docs/plans/2026-08-22-client-boundary-design.md` (approved 22 Aug 2026). Ordering
principle: the flag and its birth rules are pure reducer behavior proven by scenario before
the withholding exists; the withholding is proven by reading the actual payload before any
screen offers a toggle; the migration stands alone.

Design constraints, quoted: *"default false: nothing becomes visible except by a person's
decision"*; *"withhold unless the actor's verdict for `internal.view` is allowed"* (fail
safe); *"counts and summaries recompute over the delivered subset"*; *"marking is editing"*.

## Steps

**1. Flag + birth rules + marking arms — `lib/workspace.ts`, `lib/notes.ts`,
`lib/documents.ts`, `lib/actionShape.ts`, `app/api/mail/send/route.ts`.**
`clientVisible: boolean` on IssueRecord / IssueNote / DocumentRecord (required in the types,
defaulted at every construction site — seed import, `create`, `duplicate`, intake's create
path, `addNote`, `recordDocument`). Birth rules in `create`: true when the actor holds a
shipped client role (`rolesFor` ∩ {ROLE_CLIENT_SPONSOR, ROLE_CLIENT_LEAD, ROLE_CLIENT_USER})
or the machine role (intake); false otherwise. `addNote` and `recordDocument` gain optional
`clientVisible` (SHAPES: `opt(bool)`; default false); the mail route's recorded note passes
`clientVisible: true` — what was said to the client is client-visible by definition.
Marking after birth: `updateIssue` accepts `clientVisible` in the patch (audited like any
field); `updateNote` accepts it in its patch (author or `note.editAny`, the arm's existing
rule); documents toggle via a new small action? No — reuse `recordDocument`'s… documents
have no update arm, so add `setDocumentVisibility { id, clientVisible, now }` (KINDS +
SHAPES + ACTION_PERMISSIONS → `document.upload`), the one genuinely new arm.
*Verify:* `npx tsc --noEmit`; CB1 in step 3.

**2. Withholding — `lib/db/boot.ts` (`redactForReader`, line 232) + the grant key —
`lib/access.ts`.
THE STEP CARRYING THE MOST REGRESSION RISK** — it rewrites what EVERY reader receives, and a
wrong branch either leaks internal content to a future guest or blanks the workspace for
internal users today. `internal.view` joins PERMISSIONS and every internal shipped role's
grants (ADMIN has ALL already); `setAccess` refuses granting it to the three shipped client
role ids, in words. `redactForReader`: when the verdict for `internal.view` is NOT allowed —
issues filtered to `clientVisible`; nodes filtered to ancestors of surviving issues; notes
filtered to visible notes on surviving issues; documents to flagged ones; evidence to rows
on surviving issues whose document (if any) is flagged; audit to entries whose `rowId`
survives; rates, personSkills, estimates, timeEntries, timesheets, allocations, commitments,
changes, sows, milestones, documentReviews → empty. The existing rate/skill redaction runs
regardless. Fail-safe means the branch keys on the VERDICT, not on role identity.
*Verify:* `npx tsc --noEmit`; the payload proof in step 4 is the real check.

**3. Scenario CB1 + capability — `scripts/scenario-validation.ts` (CRLF; python),
`lib/capabilities.ts`.**
CB1 drives: internal create → false; create as a client-role actor → true; create as the
machine (intake) → true; the mail-note arm's `clientVisible: true` rides `addNote`; marking
flips via `updateIssue`/`updateNote`/`setDocumentVisibility` and refuses without the grant;
`redactForReader` for a keyless actor withholds the unmarked, keeps the marked WITH its
ancestor nodes, empties the commercial tables, and filters audit. `clientBoundary` becomes
the 22nd capability (`needs: ['internal.view']`) with CP1 moving 21 → 22 in the same commit.
*Verify:* `npm run validate:scenarios` — CB1 PASS, 0 FAIL from parsed JSON.

**4. Storage + the payload proof — `prisma/schema.prisma` (three `Boolean @default(false)`
columns), migration `20260822000003_client_visible` via `prisma migrate diff`,
`lib/db/map.ts` (three mapper pairs), `scripts/persistence-proof.ts`.**
The proof gains the round trip AND the payload case: serialize `redactForReader`'s output
for a keyless actor (`JSON.stringify`) and assert it contains no unmarked subject line, no
rate figure, no internal note body, and no audit row for an internal record — read from the
STRING, because "the screen would not have shown it" is exactly the claim this exists to
refuse.
*Verify:* `npx prisma migrate deploy` before code deploy; `npm run audit:persistence` grows
past 48; `npm run audit:tenancy` unchanged.

**5. Marking surfaces — `components/OverviewTab.tsx`, `components/NotesTab.tsx`,
`components/EvidencePanel.tsx`, `components/IssueWorkspace.tsx` (plumbing), chips in
`app/globals.css`.**
Overview: a "Client-visible" toggle chip beside the record's state (visible with
`work.edit`, both-halves). NotesTab: a checkbox beside Pin on the composer, and the chip on
visible notes. EvidencePanel: a per-document toggle + chip. Everything marked renders the
`client-visible` chip — the boundary legible at a glance.
*Verify:* `npx tsc --noEmit && npm run build`; the browser half in step 6.

**6. Sweep, deploy, checklist section 23.**
Grant `internal.view` on the Permissions screen after observing `lostInMerge` (the familiar
first step — and until it lands, non-admin internal users see the boundary-limited view,
which is the fail-safe working, stated in the checklist so nobody reads it as an outage).
Mark one OAPIL record + one note visible, verify chips; confirm via an API read as a
role-less probe that the payload carries only the marked content.

## Details most likely to be got wrong

- **Fail-safe keys on the verdict, not the role** — `!can(...,'internal.view').allowed`
  withholds, whoever you are; ADMIN's ALL covers operators from the first deploy.
- **Ancestor nodes survive; sibling branches do not** — filter nodes to the union of
  ancestor chains of surviving issues, nothing more (the design's send-back watches this).
- **The mail note is the only auto-visible note**; the proofing completion note stays
  internal.
- **`duplicate` copies the flag** — a copy of a visible record is visible; a client seeing
  "OAPIL-146" should not lose its successor.
- **Audit filtering keeps reasons** on surviving entries and drops whole entries otherwise —
  never redact a field inside an entry.
- **The payload proof reads the serialized string**, not the object graph.
- **CP1 21 → 22 rides with the capability entry**, as every count move has.

## Commits

Steps 1 alone. Step 2 alone (the risky one). Step 3 alone. Step 4 alone (migration). Step 5
alone. Step 6 with the checklist.

## What would send the design back

- Ancestor-keeping leaks sibling structure a client must not see (surfaces in step 4's
  payload proof) — a projected tree, not a filtered one.
- Intake-born-visible proves wrong for mixed-use mailboxes (surfaces in review of CB1) —
  the default moves to mailbox/form configuration.
- The fail-safe blanks the single-operator deployment (surfaces in step 6) — an explicit
  open-deployment carve-out, stated on screen.
