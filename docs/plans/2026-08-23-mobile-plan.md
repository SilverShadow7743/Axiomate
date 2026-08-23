# Mobile — implementation plan

**Design:** `2026-08-23-mobile-design.md` (approved) · **Date:** 2026-08-23

Ordering: the manifest and icons first (inert, verifiable by fetch), the service worker
second (the risky one — a wrong cache rule is invisible until somebody reads stale data),
the phone tier third (pure CSS, verified by viewport), the deploy and the real phone last.

## Steps

**1. Identity — `app/manifest.ts` (new), `app/icon.png` / icons in `app/`, the `viewport`
export in `app/layout.tsx` (LF).**
Manifest per the design; icons generated from a simple monogram at 192/512/maskable/
apple-touch (no external fetches — drawn with node-canvas or a checked-in PNG).
*Verify:* `npm run build`; `curl /manifest.webmanifest` (or the route Next mints) returns
the manifest with icons resolving 200.

**2. The service worker — `public/sw.js` (new), registration in `app/layout.tsx`.
THE STEP CARRYING THE MOST REGRESSION RISK** — a cache rule that catches `/api/*` serves
yesterday's workspace as today's, silently, to every installed client; and a bad precache
list can pin an old build until the SW updates. Network-first for navigations with a
minimal offline page; NEVER intercept `/api/*` (pass through untouched — not even
network-first-with-fallback); cache-first for `/_next/static` and fonts, keyed by build id
so a deploy invalidates. Registration is feature-checked and silent on failure.
*Verify:* `npm run build`; in the browser: the SW registers, `/api/health` requests show
"(from network)" always, a `/_next/static` asset shows "(from ServiceWorker)" on second
load.

**3. The phone tier — `app/globals.css` (CRLF, python), small component touches only if a
surface cannot reflow by CSS alone.**
One `@media (max-width: 720px)` block: the toolbar collapses to essentials, the detail
panel takes the full viewport when a record is selected, touch targets ≥40px on the five
surfaces, the week grid horizontally scrollable in its own container. No component logic
changes unless CSS cannot reflow it — and any that cannot is named in the commit.
*Verify:* `npx tsc --noEmit && npm run build`; DevTools device emulation over the five
surfaces at 390×844.

**4. Deploy, checklist §33, push.**
Clean-room release → deploy → health. Checklist §33: install from Chrome on a real phone
(the user's — an action only they can take, recorded as such), record an hour through the
grace gate, read the Inbox, submit a week; Lighthouse installability in the drive record.

## Details most likely to be got wrong

- **`/api/*` is never intercepted** — not cached, not fallback-served; the fetch handler
  returns early. This is the design's one hard rule.
- **The SW must not pin builds** — cache names carry the build id; `activate` deletes old
  caches.
- **The manifest names no client** — the same disclosure rule as the page description.
- **Icons ship in the repo** — nothing generated at build time from the network.
- **FAIL gates parse JSON** — python, utf-8 stdout, for the suite half of the sweep.

## Commits

Step 1 alone. Step 2 alone (the risky one). Step 3 alone. Step 4 with the checklist.

## What would send the design back

- A surface that cannot reflow by CSS — surfaces at step 3; reopens the five-surface list.
- Offline reads wanted — surfaces the first time somebody opens the app in airplane mode.
