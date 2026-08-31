# Boot slimming — truncate the trail's text in transit, never at rest

**Status: approved 2026-08-31** (one AskUserQuestion; carries its own plan). The performance
baseline's finding made concrete: of the 2,991 KB boot payload, the audit trail is 1,857 KB —
and 1,615 KB of THAT is `description` rows carrying imported email bodies as full
before/after texts (fattest single row: 143 KB). Age-windowing was measured and rejected:
94% of rows are under 14 days old; the weight is per-row text, not history.

## The principle that decides everything

An audit row's `from` is often the ONLY surviving copy of what a field said before an edit.
Truncating at write time would destroy the "BEFORE" that AU1 exists to answer. So:
**Postgres keeps full fidelity forever; only `boot()`'s payload truncates.** Any audit
`from`/`to` beyond 400 characters ships as a 400-char preview ending in the marker
`… [shortened for transfer — the full text is kept in the record's history]`. Nothing at
rest is rewritten; the History tab shows the marker naturally.

## Why every consumer stays correct

- The scheduled pass, delivery, and every server-side reader use `loadWorkspace`, not boot —
  untouched.
- The packs' movement counts read `field`/`rowId`; the IMS reads short status values; none
  reads long bodies.
- `clientView`'s audit-class filtering runs before the trim and is unaffected.
- The only reader who sees the marker is the human History reader, on rows nobody scrolls a
  143 KB diff of.

## Verification

Boot is server-only — the suite cannot drive it. The checks: the payload re-measured before
and after (expected ~2,991 → ~1,650 KB), all audits unchanged, and a live History-tab look
at a truncated row after deploy. The truncation lives in one small function beside boot's
other redactions, with this document cited.

## What would send this back

Somebody needing full historic text in the browser — that is a per-record history endpoint
with its own redaction proof, not a bigger boot. Surfaces in use.
