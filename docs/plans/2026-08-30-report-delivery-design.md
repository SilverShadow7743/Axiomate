# Report delivery — the daily pass learns to post the mail

**Status: approved 2026-08-30** (four explicit decisions, recorded below).
The reporting design's named non-goal — "scheduled or emailed delivery (revisit after content
settles)" — revisited the day after the content settled. The three report builders are pure and
live, the daily pass runs proven on a cadence, and outbound Graph mail already sends as the
firm's mailbox. This phase is wiring and policy, not new infrastructure.

## Decisions (settled with the user, 2026-08-30)

1. **Direction:** scheduled/emailed report delivery, chosen over the timesheet month-end loop
   and financial dimensions. (D's attachment consent — a Graph admin step, pending action A6 —
   rides along in parallel.)
2. **Send policy:** the daily IMS auto-sends to an internal recipient list; the weekly client
   pack and monthly governance pack email themselves **to the operator** — eyeball, then
   forward. Client-bound content keeps a person in the loop (the recorded reporting-phase
   decision stands). **The finance report never auto-sends.**
3. **Cadence:** IMS every weekday; weekly packs every Monday covering the prior week; monthly
   packs on the 1st covering the prior month — timed so what lands is a complete period.
4. **Form:** every email carries a **branded PDF attachment**, produced by a **pure-JS
   renderer (pdfkit)** — chosen over headless Chromium, which at ~300MB beside Next.js on the
   B1's 1.75GB is a works-locally-fails-on-App-Service machine. Recipients are a configurable
   internal list in Configuration, defaulting to the operator.

## The delivery step in the pass

`runScheduledPass` (lib/db/schedule.ts) gains a delivery phase with pure due-logic:

- **Due:** IMS on weekdays; weekly packs on Mondays; monthly packs on the 1st.
- **Dedupe:** a last-sent stamp per report kind (date / week-starting / month) lives in the
  pass's existing `Observation` memory — the store already tolerates partial reads
  (`Partial<Observation>` at the load site), so an optional `delivery` field extends it
  without a migration. A second run in the same day (manual trigger, Logic App retry) finds
  the stamp and sends nothing.
- **Stamps are written only after a successful send** — a refused send retries on the next
  pass with no special retry machinery.
- **Off by default.** A new `reportDelivery` config (per-report on/off, IMS recipients, pack
  destination) ships disabled; a deploy must not start emailing by surprise.
- Weekly/monthly packs generate for **every client node holding at least one client-visible
  record**; one email per pack, the subject naming client and period.

## The PDF layer — and its one hard rule

`lib/reports/pdf.ts`: three renderers taking **only the pure report objects the screens
already use** (`DailyIms`, `WeeklyClientPack`, `MonthlyGovernancePack`) plus
`OrganizationIdentity` — never `WorkspaceState`. RP2's sentinel scan pins what a pack object
may carry; a renderer that cannot see state cannot leak what the object does not hold. Each
PDF: the branded header (firm name and short name; the logo embedded when the stored data URI
is PNG/JPEG, wordmark styling otherwise), then tables matching the on-screen sections,
including the packs' disclosure line and Progress block.

## Mail and configuration

- `sendAsMailbox` (lib/mail.ts) gains an optional **trailing** `attachments` parameter
  (Graph `fileAttachment`, base64) — additive; every existing call and its wire body stay
  byte-identical when absent.
- Configuration gains a **Report delivery** card: per-report toggles, the IMS recipient list,
  the pack destination address (default: the operator's directory email). A new
  `setReportDelivery` config op — name in `actionShape`'s CONFIG_OPS, arm in `applyConfig` —
  riding the wholesale `operatingModel` persistence like `setOrganization`: **no persistence,
  audit or migration work.**
- Sends go out as the same mailbox the notification drain uses.

## Error handling

A refused send lands in the pass's run report with the Graph status — the pass already
reports honestly — and, with no stamp written, retries next pass. An unrenderable logo falls
back to wordmark. An empty recipient list means that report is simply not due. An empty
workspace period still sends (a quiet week is a report, not an error) — the IMS already words
its own empty states.

## Testing

New scenario **RD1** drives the pure due-logic: weekday/Monday/1st resolution, stamp dedupe
(due Monday, stamped this week → not due), off-by-default, empty recipients = not due, and a
smoke check that each renderer yields a `%PDF`-prefixed buffer from RP2-style fixture
objects. Suite 187 → 188. Live verification: enable delivery, trigger the pass manually,
receive the emails, open all three PDFs.

## Non-goals

Client-direct sends, finance auto-send, per-client recipient lists, HTML bodies, send-time
customization, weekend IMS.

## What would send this design back

- The `Observation` store cannot carry delivery stamps cleanly (a shape conflict with the
  watch machinery) — the stamp then needs its own row, a storage change this design says it
  does not need. Surfaces at the first implementation step.
- pdfkit cannot embed the logo data URIs users actually upload — the PDFs ship wordmark-only,
  a noted reduction rather than a redesign. Surfaces at the renderer step.
- Graph refuses attachments for this app registration (a consent narrower than Mail.Send
  implies) — delivery falls back to text bodies pointing at the app while the consent is
  fixed, and the design's "PDF attachment" half reopens with the user. Surfaces at live
  verification.
