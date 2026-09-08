# Seeing an email's actual content, not just the preview snippet

**Status: built, 8 September 2026.** User's direct request — *"How can I see the email content
in a proper way."*

## Build summary

- `app/api/mail/message/[id]/route.ts` (new) — `GET`, one message at a time, under the same
  `getPersonalGraphToken`/`Mail.Read` posture as `/api/mail/inbox`. Reads
  `subject,from,receivedDateTime,body`; returns `contentType: 'html' | 'text'` and `content`
  (never storing either). `401`/`403` from Graph maps to `reconnect: true`, matching the
  existing inbox route's convention exactly.
- `components/InboxPanel.tsx` — the subject in each row is now a button (`openMessage`), plus an
  explicit "Open…" action for discoverability; both open the same modal. Fetches on click, not
  eagerly for the list. `html` content renders inside `<iframe sandbox="" srcDoc=...>` — bare
  `sandbox`, not `allow-same-origin` (caught in advisor review before push: `allow-same-origin`
  would have handed the frame same-origin privileges it never needs, for zero benefit, on a
  `srcDoc` frame that is already opaque-origin and script-refused without it). No token means
  scripts, forms and top-level navigation are all refused by the browser itself, and the frame
  cannot reach `parent.*` even if a later edit ever added `allow-scripts` by mistake. `text`
  content renders as `<pre>`.
- `app/globals.css` — `.ibx-subject-btn`, `.ibx-open-modal`, `.ibx-open-frame`,
  `.ibx-open-text`. The iframe keeps a fixed white background regardless of app theme, matching
  how every real mail client renders a message pane — email HTML is written assuming a white
  canvas.

**Verification**: `tsc --noEmit` clean; `npm run build` clean, new route confirmed in the route
table (`ƒ /api/mail/message/[id]`); 257 scenarios, unchanged (this is a pure Graph passthrough
with no reducer/`WorkspaceState` logic, the same posture I8 already established — nothing for
the scenario harness to drive); clean `audit:tenancy`.

**Deferred to a follow-on, as named in the design**: inline images (`cid:` references) render as
broken-image icons until a per-image Graph fetch is added; attachment download stays out per the
original `in-mail` non-goal. **Remote-image (tracking-pixel) blocking was flagged for the build
pass to verify and was not verified** — stated plainly rather than assumed, per the same
correction advisor review raised on the sandbox value; whether the browser's default sandboxed-iframe
behavior actually blocks a remote image load needs a real check, not an assumption, before this
line can say more than "not tested."

## The gap

`InboxPanel.tsx` shows `preview` — Graph's `bodyPreview`, a plain-text snippet Microsoft
truncates to roughly 250 characters. `/api/mail/inbox`'s `$select` never asks for `body` at all
(`app/api/mail/inbox/route.ts`). There is no way today to read a message past its first line or
two without leaving Axiomate for Outlook.

## Shape

**Fetch on open, not on list.** The 25-message list stays exactly as cheap as it is today —
`body` is not added to the list `$select`. Opening a message (a click, already the natural place
a "read this" action belongs) triggers a new request for that one message's full content:

```
GET /api/mail/message/[id]  →  { ok, subject, from, receivedAt, contentType, content }
```

reading `GET /me/messages/{id}?$select=subject,from,receivedDateTime,body` under the same
`Mail.Read` grant already held — no new Entra consent, same as every prior in-mail extension.
Same RAM-only, never-stored posture as the rest of `in-mail`: this is a live per-request Graph
passthrough, the response reaches only the requesting person's session, and nothing here touches
`WorkspaceState`, the database, or the shared search index.

**Rendering `contentType: 'html'` safely is the one real decision in this doc.** Graph mail
bodies are, in practice, almost always HTML — and HTML from an arbitrary external sender is
untrusted content. Rendering it via `dangerouslySetInnerHTML` directly into the page's own DOM
would let a malicious or compromised sender run script, exfiltrate the session, or reach page
state a scam email should never be able to touch — a real XSS opening, not a hypothetical one.

The safe shape: render inside a **sandboxed `<iframe srcdoc="...">`** with a bare `sandbox`
attribute — no tokens at all, not even `allow-same-origin` — which puts the email's markup in a
separate, opaque-origin browsing context with scripts, forms, and top-level navigation all
refused by the browser itself, not by a sanitizer this codebase would have to get right and keep
right. `contentType: 'text'` renders as preformatted plain text — no iframe needed, nothing to
sanitize.

## What stays out, deliberately

**Inline images** (`cid:` references inside the HTML, resolved against the message's own
attachments) are a known follow-on, not this pass — showing them needs a per-image Graph fetch
(`/messages/{id}/attachments/{attachmentId}/$value`) and a way to swap `cid:` src attributes for
that, which is real additional surface. Broken inline images render as broken-image icons in the
interim, same as any mail client does before that wiring exists — not a blocker, just visible.
**Attachment download** stays out, unchanged from the original `in-mail` design's own non-goal
(a documents-consent question, not a mail one). **Remote-image blocking** (a privacy practice
mail clients use to stop read-receipt tracking pixels) is worth naming even though it is a
default browsers already apply somewhat inconsistently inside a sandboxed iframe — flagged for
the build pass to verify rather than assumed here.

## What would send this back

If Graph's per-message fetch under real inbox volume turns out slow enough to make opening a
message feel broken (unlikely — this is one message, not 25), the fallback is a loading state on
the panel, not a redesign. If the sandboxed iframe turns out to clip or mis-render a real vendor
email's layout in a way that matters, that is a CSS/sizing problem to fix inside the sandbox
boundary, not a reason to loosen the sandbox itself — the sandbox is the whole safety argument
and does not get traded away for a layout fix.
