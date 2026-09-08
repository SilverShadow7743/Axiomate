# Seeing an email's actual content, not just the preview snippet

**Status: draft, 8 September 2026.** User's direct request — *"How can I see the email content
in a proper way."* Not built.

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

The safe shape: render inside a **sandboxed `<iframe srcdoc="...">`**
(`sandbox="allow-same-origin"` and nothing else — no `allow-scripts`), which puts the email's
markup in a separate browsing context with scripts, forms, and top-level navigation all refused
by the browser itself, not by a sanitizer this codebase would have to get right and keep right.
`contentType: 'text'` renders as preformatted plain text — no iframe needed, nothing to sanitize.

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
