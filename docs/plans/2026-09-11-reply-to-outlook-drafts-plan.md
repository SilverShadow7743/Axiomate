# Reply to Outlook Drafts — implementation plan

*11 September 2026. Follows `2026-09-08-scheduled-reply-design.md`, whose fork Nishant resolved on
11 Sep as **Option C**: "Axiomate hands the reply to Outlook, already written, for me to send or
schedule there." No new storage, no change to the RAM-only token posture.*

## Ordering principle

Pure-first has nothing to bite on here — there is no new pure logic, only a Graph call sequence
that already exists minus its last step. So the order is: the library split (provable by reading
the one caller stays byte-identical), then the route (provable by `tsc` and by the existing
`send` path still returning `{ ok: true }` with no `mode`), then the dialog, then a live draft
against a real message — the only step that can prove the draft actually lands in Drafts.

## Steps

**1. `lib/personalGraph.ts` — split the reply sequence.** `replyToMessage` is three Graph calls
(`createReply`/`createReplyAll` → `PATCH` body → `send`). Extract the first two as
`draftReply(token, messageId, htmlContent, replyAll)` returning `GraphResult<{ id; webLink }>`
— the `PATCH` response is the message resource, and `webLink` on it opens that draft in
Outlook on the web. `replyToMessage` becomes `draftReply` then `send`, so the send path is the
same three calls it was. **The detail most likely to be got wrong:** the signed content is
*prepended* to `created.data.body.content`, never replacing it — the quoted thread is what
`createReply` gives us and what a reader of the draft expects to see beneath the reply.

**Verify:** `npx tsc --noEmit`; `replyToMessage`'s body reads as `draftReply` + one `send` call.

**2. `app/api/mail/reply/route.ts` — one route, two modes.** Accept `mode?: 'send' | 'draft'`,
default `'send'` so every existing caller is unchanged. The signature build is shared (it runs
before the branch). On `'draft'`, call `draftReply` and return `{ ok: true, draft: { id, webLink } }`;
on any Graph refusal, the same `describeGraphRefusal(res, 'draft')` shape the send path uses.
Nothing is recorded — the draft lives in the person's own Drafts, exactly as `saveToSentItems`
already leaves the sent copy in their own Sent Items.

**Verify:** `npx tsc --noEmit`, `npm run build`.

**3. `components/InboxPanel.tsx` — the control.** In the reply dialog, a second button beside
Send: **"Save to Outlook Drafts"** as `.btn` — Send stays the one `.btn.primary` (F&O's
one-primary rule, `docs/design/navigation-model.md`). It posts the same body with
`mode: 'draft'`; on success the dialog closes and the row shows a `drafted` badge that links to
`webLink` ("Open in Outlook") when Graph returned one. The dialog's note gains one sentence
saying what the draft is for: finish it, or use Outlook's own *Schedule send* — the timing
lives in Outlook, never in Axiomate.

**Verify:** `npx tsc --noEmit`, `npx eslint components/InboxPanel.tsx`, `npm run audit:a11y`,
`npm run build`.

**4. Live (last).** Against production, from "Your inbox": open Reply on a real message, type a
line, *Save to Outlook Drafts*. Then confirm the draft exists in the signed-in person's own
Drafts folder (the M365 connector's mail search, or Outlook itself) with the reply text above
the quoted original and the signature block beneath the text — then remove the test draft.
Also confirm plain *Send* still sends (or at least still reaches the same route with no `mode`
and returns `{ ok: true }`) — the regression this step exists to catch.

## The step carrying the most regression risk

**Step 1.** It touches the only path that sends personal mail. If the split drops the `send`
call or reorders the prepend, every reply from "Your inbox" either silently becomes a draft or
loses its quoted thread — in the hands of whoever replies to a client next. The guard is that
`replyToMessage` after the change is *textually* `draftReply` + `send`, and step 4's plain Send
check.

## Commits

One commit for steps 1–3 (a draft control with no route behind it, or a route with no
control, is half a feature). Docs (this plan, the design's status line, the backlog row) ride
with it.

## What would send this back to the design

- If `createReply`'s draft does not carry `webLink`, or Outlook on the web cannot open a draft
  by that link — surfaces at step 4. Then the badge says "saved to Drafts" with no link, and the
  design is not wrong, only the affordance is smaller.
- If a saved draft is *not* visible in Outlook's Drafts folder (Graph put it somewhere else) —
  surfaces at step 4 and is a design question, because the whole point of C is that Outlook
  owns it from there.
