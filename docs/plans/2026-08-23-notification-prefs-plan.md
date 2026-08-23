# Notification preferences — implementation plan

**Design:** `2026-08-23-notification-prefs-design.md` (approved) · **Date:** 2026-08-23

Ordering: the pure vocabulary and `modeFor` first (provable with no callers), then the
model key plumbed inert, then the action and the three mint-site overlays with NP1 driving
every branch, then the Inbox block, then the deploy. The design's constraint that matters
most is quoted where it bites: "the no-pref default minting exactly one in-app record is
the guard, and it runs before any pref is ever set."

## Steps

**1. The vocabulary and the pure rule — `lib/notifications.ts` (LF, Edit tool).**
`NOTIFICATION_KINDS = ['assignment', 'intake-arrival', 'automation'] as const` +
`NotificationKind`; `NOTIFICATION_MODES = ['mute', 'in-app', 'in-app+email'] as const` +
`NotificationMode`; `NotificationPrefs = Record<string, Partial<Record<NotificationKind,
NotificationMode>>>`; `modeFor(prefs, personId, kind): NotificationMode` — null/undefined
personId, absent person, absent kind, and an unrecognised stored mode ALL answer
`'in-app'`; and `notificationPrefProblem(kind, mode)` refusing values outside the unions in
words.
*Verify:* `npx tsc --noEmit` clean; the functions have no callers yet so the suite stays at
89, 0 FAIL parsed from `data/validation.json` with python (utf-8).

**2. The model key, inert — `lib/config.ts` (LF, Edit tool).**
Import the types; `notificationPrefs: NotificationPrefs` on `OperatingModel` under
`allocationPolicy`; `notificationPrefs: {}` in the seed factory; the explicit `mergeModel`
arm `{ ...seed.notificationPrefs, ...(stored.notificationPrefs ?? {}) }` — the
undefined-key crash class every policy merge here documents. Check the import direction:
`config.ts` already imports from `capacity.ts` and `timeWindow.ts`; `notifications.ts`
imports nothing from `config.ts` (verify with grep before writing).
*Verify:* `npx tsc --noEmit`; suite 89, 0 FAIL — nothing reads the key.

**3. The action and the three overlays — `lib/workspace.ts`, `lib/actionShape.ts`,
`lib/access.ts`, `app/api/workspace/route.ts` (all CRLF; python anchored edits),
plus NP1 in `scripts/scenario-validation.ts` (CRLF).
THE STEP CARRYING THE MOST REGRESSION RISK** — it touches three mint sites that currently
always mint, and a wrong-way check silently swallows notifications nobody knows to miss.

- **Action union** (~line 982, beside `markNotificationRead`):
  `{ t: 'setNotificationPref'; personId: string; kind: NotificationKind; mode:
  NotificationMode; now: string }`. The arm: validate via `notificationPrefProblem`;
  refuse unless `directoryPersonFor(state.model, actor)?.id === a.personId` or
  `can(state.model, actor, 'config.edit').allowed`, in words ("Preferences are the
  person's own…"); no-op with "Nothing changed." when already so; write
  `model.notificationPrefs[personId][kind]`; audit field `notification.prefs`, rowId
  `a.personId`, from/to as "kind: mode" words.
- **The four registration points, together in this commit** — the wire lesson:
  `KINDS` in `app/api/workspace/route.ts` (~line 58 block), SHAPES in `actionShape.ts`
  (`personId: req(id), kind: req(oneOf(new Set(NOTIFICATION_KINDS))), mode:
  req(oneOf(new Set(NOTIFICATION_MODES))), now` — `oneOf` takes a Set, never an array),
  `ACTION_PERMISSIONS` in `access.ts` → `null` beside `markNotificationRead` (the arm's
  self-or-admin rule is the gate).
- **Assignment mint** (`updateIssue`, ~line 2170): resolve the new owner's id (already
  computed as `toId`); `modeFor(state.model.notificationPrefs, toId, 'assignment')` —
  `mute`: skip the mint, write the audit line with ` (muted by their preference)` appended
  to the `to` column; `in-app+email`: mint the existing record AND a second with
  `channel: 'email'` through `deliveryFor('email')` (two seq increments, two ids); default:
  byte-for-byte today.
- **Intake mint** (`create`, ~line 1685): same overlay per triager inside the existing
  loop — one person's mute must not affect the others.
- **`notify` arm** (~4774): overlay with kind `'automation'`, applied ONLY when
  `directoryIdByName` resolves (role labels untouched); `mute` suppresses regardless of the
  rule's channel, with the audit line saying so; `in-app+email` adds the email record only
  when the rule's own channel is not already `email` (no doubling).
- **NP1**, through the real ops on BASE (Priya is a directory person; W/Z scenarios show
  the assignment-mint idiom): default path first — one in-app record, the regression
  guard; then `in-app+email` → two records, the email one `pending` with the drain's
  queue note; then `mute` → zero records, the audit line carrying "muted"; a second actor
  (`actAs`) refused setting Priya's pref without `config.edit` and allowed with the
  Validator's own; a `notify` to a role label (`to: 'Delivery Lead'`) unaffected; kind and
  mode outside the unions refused in words.
*Verify:* `npm run validate:scenarios` → 90 scenarios, 0 FAIL parsed; NP1 PASS; W and Z
(the existing notification scenarios) still PASS — they are the default-path guard at
suite level.

**4. The Inbox block — `components/Inbox.tsx` (LF, Edit tool),
`components/IssueWorkspace.tsx` (CRLF, python; the dispatch plumbing).**
A Preferences section at the top of the Inbox: three rows in the design's words ("When
work is assigned to me…" / "When a new request arrives…" — this row only when the viewer
holds `work.assign`, matching who the intake mint addresses / "When a watch rule fires for
me…"), each a three-way choice dispatching `setNotificationPref` with the viewer's own
directory id (from `directoryPersonFor`; the block absent entirely when the viewer resolves
to nobody — there is no id to store a preference under, and the block says so in one
line). The email choice states out loud when the person has no email in the directory.
Plumbing: Inbox gains `meId` (already has it) and an `onSetPref(kind, mode)` prop wired in
IssueWorkspace to `dispatch({ t: 'setNotificationPref', personId: meId, kind, mode, now })`.
*Verify:* `npx tsc --noEmit && npm run build` clean.

**5. Sweep, deploy, checklist section 26, push.**
Suite (parsed), `npm run audit:persistence` (50 — the prefs ride the model document, no
schema change), attribution, tenancy. Clean-room release → `az webapp deploy` → health
probe → `git push origin master`. Checklist section 26: the block shows three rows with
in-app selected; email me my assignments → assign → two records, the email pending for the
pass; mute intake → an intake arrival mints nothing and History says why; another person's
prefs untouchable without the grant. Browser half waits on the Chrome extension if it is
still disconnected — say so in the drive record rather than skipping silently.

## Details most likely to be got wrong

- **The default path must not move.** No pref set → exactly one in-app record at every
  site. NP1 asserts it FIRST, and W/Z keep asserting it at suite level; if either shifts,
  the overlay is wrong-way and the fix is the check, not the scenario.
- **`mergeModel` defaults the key explicitly** — the spread leaves it `undefined` on every
  stored model and the first `modeFor` read crashes production, not the seed.
- **`oneOf` takes a Set** — `oneOf(new Set(NOTIFICATION_KINDS))`; a plain array is the
  actionShape trap already hit once this program.
- **All four registration points in one commit** — union, KINDS, SHAPES, ACTION_PERMISSIONS;
  the missing-KINDS failure is a silent 400 the optimistic client papers over until the
  pill sticks at "Not saved".
- **The intake loop overlays per person** — one triager's mute must not `continue` out of
  the whole loop.
- **The audit line writes even when the mint does not** — silence by request is still a
  stored answer; dropping the audit with the record makes "why didn't I get this"
  unanswerable, which the design forbids.
- **The `notify` arm's no-doubling rule** — a rule already on the email channel plus an
  `in-app+email` pref is ONE email record, not two.
- **FAIL gates parse JSON** — python, utf-8 stdout, never a string grep.

## Commits

Steps 1 and 2 together (the vocabulary and its inert key are meaningless in halves).
Step 3 alone (the risky one). Step 4 alone. Step 5 with the checklist.

## What would send the design back

- **Quiet hours or digests** wanted — surfaces at the Inbox block wording (step 4); that is
  scheduling and reopens the drain, not the prefs shape.
- **Mandatory kinds** (compliance-unmutable notifications) — surfaces at NP1 review
  (step 3); adds a policy dimension the shape does not carry.
- **Preferences per engagement** — surfaces wherever a person asks for different behaviour
  on different clients; reopens where the prefs live.
