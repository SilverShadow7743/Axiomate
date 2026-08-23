# Notification preferences — design

**Date:** 2026-08-23 · **Register item:** #5 · **Status:** approved

## What exists, and what this changes

Notifications are records with honest delivery states (`lib/notifications.ts`): in-app is
delivered the moment it is written because the inbox is the delivery; email is written
`pending` and drained by the scheduled pass through the same Graph client as client mail,
stamped with what actually happened. There are three mint sites: the `notify` arm
(automation rules, channel chosen per rule), and two built-in in-app mints — `assignment`
in the `updateIssue` arm and `intake-arrival` in the `create` arm.

Nothing is per-person: everyone gets everything, always in-app from the built-ins, and only
a rule's author picks a channel. This design adds the person's own say.

## The chosen approach, and the two rejected

**Chosen: per-person, per-kind modes, self-served.** For each notification KIND —
`assignment`, `intake-arrival`, `automation` (anything rule-raised) — a person picks a MODE:
`mute`, `in-app` (the default, today's behaviour), or `in-app+email`. The common asks
("email me my assignments", "stop the intake pings") are exactly kind-shaped.

Rejected: **B**, per-rule subscriptions — rules are firm-level objects with arbitrary ids
and the surface gets noisy for no ask anybody has made; and **C**, a single email toggle —
too coarse to be called preferences.

## The design

### 1. The prefs

`model.notificationPrefs: Record<personId, Partial<Record<NotificationKind, NotificationMode>>>`
— keyed by directory id, absent meaning `in-app` for every kind, so a future kind defaults
to today's behaviour rather than crashing. Declared in `lib/notifications.ts` beside the
records they govern:

- `NOTIFICATION_KINDS = ['assignment', 'intake-arrival', 'automation']`
- `NOTIFICATION_MODES = ['mute', 'in-app', 'in-app+email']`
- `modeFor(prefs, personId, kind)` — pure; null/absent anything → `'in-app'`.

Merged in `mergeModel` per person (`{ ...seed, ...stored }` at the top level of the map).
No migration — the operating model is a stored document.

### 2. Enforcement at mint

All three mint sites consult `modeFor`. The kind at each site: the built-ins pass their own
ruleId (`assignment`, `intake-arrival`); the `notify` arm passes `automation`.

- **`mute`** — nothing is minted, but the audit line still writes, marked
  "(muted by their preference)" — "why didn't I get this" must have a stored answer.
- **`in-app`** — exactly today, byte for byte.
- **`in-app+email`** — the in-app record PLUS an email-channel record, `pending`, for the
  scheduled pass's existing drain to send and stamp. Two records, because delivery state is
  per channel and that is the shape the model already has.
- The `notify` arm's overlay applies only when `directoryIdByName` resolves the target to a
  person: role labels and unknowns are untouched, because a preference belongs to a person
  and a role label is not one. A rule already addressed to the `email` channel is also
  untouched by `in-app+email` (no doubling); `mute` suppresses it regardless of the rule's
  channel.

### 3. The action

`setNotificationPref { personId, kind, mode, now }` — a first-class action, not a config
op, because it is self-service: the arm refuses unless the ACTOR resolves (via
`directoryPersonFor`) to that very person, or holds `config.edit`. Kind and mode validated
against the two unions in words. Audited: `notification.prefs` on rowId = personId,
from/to as "kind: mode" words, so the trail says who changed whose preferences.
ACTION_PERMISSIONS maps it to null (no separate grant — the arm's own self-or-admin rule is
the gate, like note authorship).

### 4. The screen

A Preferences block at the top of the Inbox panel — where the notifications already land —
three rows in words:

- "When work is assigned to me…"
- "When a new request arrives…" (shown only to people the intake mint can address — those
  holding `work.assign` — so nobody configures a notification they can never receive)
- "When a watch rule fires for me…"

each with "tell me here / also email me / don't tell me". The email option states out loud
when the person has no email in the directory: the record would queue and the drain would
fail honestly, but saying so before the choice beats a pending row later.

### 5. Proof

Scenario **NP1**: an assignment with no pref set mints exactly today's single in-app record
(the default path is the regression guard); pref → `in-app+email` and the next assignment
mints two records, the email one `pending` with the drain's queue note; pref → `mute` and
the next assignment mints nothing while the audit says why; a second person setting the
first's pref refused without `config.edit`, allowed with it; an automation `notify` to a
role label unaffected by any person's pref; kind/mode outside the unions refused in words.

## Regression risk, named

The mint sites currently ALWAYS mint. A wrong-way pref check silently swallows assignment
notifications for everyone — and missing notifications are invisible by definition; nobody
files a bug about a ping they never knew to expect. NP1's first assertion — the no-pref
default minting exactly one in-app record — is the guard, and it runs before any pref is
ever set.

## Out of scope, stated

- **Digest/batching** — a scheduling question, not a preference shape.
- **Teams transport** — the channel stays honest-pending until a transport exists.
- **Per-rule granularity** — approach B, if it is ever actually asked for.

## What would send this back

- A wish for **quiet hours or digests** — that is scheduling, and reopens the drain, not
  the prefs shape.
- **Mandatory kinds** — a firm wanting some notifications unmutable (compliance) would add
  a policy dimension the shape does not carry.
- **Per-engagement preferences** — reopens where the prefs live.
