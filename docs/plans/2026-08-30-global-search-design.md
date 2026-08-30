# Global search — one box over everything the reader may see, and nothing else

**Status: approved 2026-08-30** (two AskUserQuestion decisions: this phase is global search
alone from the Hive steal-list; the client-side-over-boot approach). The comparison's finding:
Hive searches across actions and notes; Axiomate's toolbar box filters grid rows only —
notes, mail and documents are unreachable. The beat-Hive angle is not breadth, it is the
property Hive cannot claim: **search that structurally cannot leak.**

## The one architectural fact this design stands on

`boot()` (lib/db/boot.ts, `redactForReader`) already hands each browser exactly what its
reader may see: rates gone without `rate.view`, skills field-redacted, leave reasons blanked,
and the full `clientView` cut for client-seated readers. A search that runs CLIENT-SIDE over
that state inherits every one of those guarantees by construction — there is no second egress
surface to redact, no new permission plumbing to prove. Rejected: a Postgres full-text
endpoint (covers discussion, scales further, but creates a brand-new leak surface needing its
own sentinel discipline — the wrong first move); revisit as v2 if discussion search is the
real demand.

## The pure module

`lib/search.ts` — `searchWorkspace(state, query, today): SearchHit[]`, no clock, no I/O:

- Corpus: issues (id, subject, owner, nextAction, evidence, clientImpact, reference, source),
  note bodies, inbound mail (from, subject, body), document names, people (name, email),
  meetings (title). Deleted/archived rows excluded.
- Matching: tokenized, case-insensitive substring per token, ALL tokens must hit somewhere on
  the record; field weights (id/subject highest, body text lowest); a recency tilt from
  lastActivity/date; cap 50 hits.
- `SearchHit { kind: 'issue'|'note'|'mail'|'document'|'person'|'meeting', id, anchorId,
  title, snippet }` — `anchorId` is the issue/record the UI opens; `snippet` is match context
  (~90 chars around the first hit, match marked for highlighting).

## UI

The existing toolbar search box keeps its live row-filtering and GAINS a grouped results
dropdown (Issues · Notes · Mail · Documents · People · Meetings) while typing, debounced.
Enter opens the top hit; clicking a note/mail hit opens its parent record's detail at the
right tab. Keyboard: arrows move, Escape closes. The empty state names what WAS searched and
states plainly that discussion messages are server-side and not yet searchable.

## The property, pinned

Scenario **GS1** (suite 188 → 189) drives:
- relevance basics: id hit outranks body hit; all-tokens rule; deleted rows absent; cap holds;
- **the boundary composition**: sentinels planted in a full fixture (rate amount, leave
  reason, internal note body, internal record subject) are FOUND when searching the raw
  state — and NOT FOUND when searching the same state after the reader redaction a
  client-seated or ungranted actor gets. The by-construction claim becomes executable, like
  every other egress surface.

## Non-goals

Discussion bodies (v2 via the existing server-queried discussion API), document contents
(SharePoint owns them), stemming/fuzzy matching, search history, server-side anything.

## What would send this design back

- Search over production-size boot state measurably lags typing (unlikely: ~260 issues +
  notes is a trivial scan; the 3MB payload is a transfer cost, not a scan cost) — the answer
  is a memoized index, not a server move. Surfaces at live verification.
- The thing people actually search for turns out to be discussion messages — v2's server
  design opens properly rather than being bolted on. Surfaces in use.
