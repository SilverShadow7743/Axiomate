# Mobile — design

**Date:** 2026-08-23 · **Phase:** 8 of the Hive gap program · **Status:** approved

## The choice

An installable PWA over the one codebase, not a store app. A React Native client is a
program — a second codebase, a token auth story beside the cookie session, store review
cycles — and everything it would need (a stable wire, idempotent replays, honest payloads)
now exists, so it can be started later without rework. What a consultant needs on a phone
today is narrower: their work, their inbox, a record, an hour recorded, a week submitted —
installable from the browser, launched from the home screen.

## The design

### 1. Identity

`app/manifest.ts` — name, short name, `display: standalone`, theme and background from the
shipped palette; icons 192/512 plus maskable plus apple-touch; the `viewport` export.

### 2. Offline: the shell yes, the data never silently stale

A minimal service worker: precache the app shell; **network-first with NO cache fallback
for `/api/*`** — an offline READ says it is offline rather than showing yesterday's hours
as today's, because a stale number presented as fresh is the exact dishonesty the delivery
states exist to prevent. Offline WRITES need nothing new: the autosave queue holds them,
the drain retries, the unload beacon delivers — the machinery proven under §24. Fonts and
static assets cache-first.

### 3. The phone pass

A `max-width: 720px` tier in the existing stylesheet. My work is the landing surface (the
landing rule already prefers it when the queue is non-empty); the detail panel becomes the
primary full-width surface; touch-sized controls on the five phone surfaces — My work, the
Inbox and its preferences, record detail (Overview / Notes / Time), the time-entry form
with its grace gate, and the Timesheets panel. The tree and the Gantt remain desktop
instruments; nothing is removed anywhere — the tier only reflows.

### 4. Proof

The suite is UI-independent and stands as-is. Verification: Lighthouse installability in
the clean room, and checklist §33 on a real phone — install, record an hour through the
grace gate, read the inbox, submit a week.

## Out of scope, stated

- **Offline reads** — a stale-tolerant cache is a data-honesty decision to be made
  explicitly, not smuggled in with a manifest.
- **Push notifications** — a transport beside email/Teams; the notification preferences
  would gain a channel, which is its own design.
- **The store app** — approach B, when the firm wants it.

## What would send this back

- Offline reads wanted after all.
- The phone pass revealing a surface that cannot reflow without redesign (the grid is
  already excluded; a second one would reopen the five-surface list).
