# Outward integrations — a webhook channel, not a new engine

*7 September 2026. From the Hive gap survey's "Integrations" line — flagged, not built same-day,
because the obvious shape breaks a rule this codebase already wrote down on purpose. This design
resolves the conflict rather than overriding it.*

## The conflict, precisely

`lib/automation.ts`'s own module comment states the invariant this design must not break:

> *"A rule does not write to state. It produces the same `Action` values a person's click
> produces, and those go through the same reducer... A rule cannot do anything a person could
> not."*

A webhook POST to Slack, Teams, or Zapier is a call to a system outside this application's data
model — it is not a reducer `Action`, and no person's click "does" it either. Adding a `webhook`
`RuleActionKind` that reaches out over the network from inside the automation engine would give
that engine a second write path with no reducer, no permission check and no audit trail behind
it — exactly the failure mode the module comment names as the alternative it rejected.

## What already exists, and settles the shape

`lib/notifications.ts` already has this exact problem solved for a different transport: `Channel`
is `'in-app' | 'email' | 'teams'`, and `email`/`teams` notifications are **written as `pending`**
because "there was no transport" at rule-fire time — the module's own words. `lib/db/notifyDrain.ts`
answers what happens next: a scheduled pass (`app/api/schedule/run/route.ts`), running *after*
the reducer's transaction, reads pending email notifications, actually sends them via the outward
Graph door, and stamps the real outcome (`delivered`/`failed`) back through the reducer via
`markNotificationDelivery` — "a delivered notification says delivered because it was, not because
it was about to be."

A webhook is not a new capability the automation engine needs. It is a fourth `Channel`, drained
the same way `email` already is.

## Schema

```prisma
model WebhookConfig {
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  /// One per tenant today — see "What would send this back". `default` while that holds.
  id     String @default("default")
  url    String
  /// HMAC-SHA256 key, generated server-side at creation, never accepted from a form. Signs
  /// every delivery so the receiving endpoint can verify it came from this tenant.
  secret String
  enabled Boolean @default(false)

  configuredBy String
  configuredAt DateTime

  @@id([tenantId, id])
}
```

Set once through Configuration → Routing & intake, beside the existing mailbox config, by
whoever holds `config.manage` — the same authority that already sets the intake mailbox address.
**Not** a field a rule or a runtime action can set: the target URL is an administrator's decision
made ahead of time, the same trust boundary `IntakeMailbox.address` already carries. This is what
keeps the SSRF surface bounded to "an admin who already has `config.manage` can point outbound
traffic somewhere" — a real but pre-existing trust level, not a new one this feature opens up.

## Delivery

`drainWebhookNotifications(tenantId, actor, now)`, mirroring `drainEmailNotifications` exactly:
reads up to 20 pending `webhook`-channel notifications oldest-first, and for each, POSTs

```json
{ "id": "...", "subject": "...", "body": "...", "aboutId": "...", "ruleId": "...", "at": "..." }
```

to `WebhookConfig.url`, with an `X-Axiomate-Signature: sha256=<hex hmac>` header over the raw
body using `WebhookConfig.secret` — the same shape GitHub's and Stripe's own webhook signing use,
chosen because it is the pattern a receiving endpoint (Zapier, a Slack incoming-webhook relay, a
firm's own listener) is most likely to already know how to verify. A non-2xx response or a
timeout (5s, matching the outward mail door's own budget) stamps `failed` with the status in the
note; success stamps `delivered`. Called from the same `app/api/schedule/run/route.ts` pass,
immediately after `drainEmailNotifications` — same reasoning for running after the transaction
rather than inside it: a network call must not hold a Serializable lock.

## Where a rule reaches it

`RuleAction.channel` gains `'webhook'` as a value alongside `'in-app' | 'email' | 'teams'` — no
new `RuleActionKind`. A firm wanting "post to Slack when High severity work is raised" clones
`AUTO_HIGH_RAISED` with `channel: 'webhook'` instead of `'in-app'`. Same condition matching, same
`{id}`/`{subject}`/`{from}`/`{to}`/`{by}` substitution, same audit trail naming which rule fired —
the only thing new is where the message ends up.

## What this does not do

No incoming webhooks — nothing this application exposes for an external system to call *in*; that
is a different design with a different authentication question. No per-webhook custom payload
templates beyond the existing `text` substitution — the JSON shape above is fixed. No OAuth
install flow (a real "Add to Slack" button) — one URL, set by an administrator, is the whole
mechanism. No retry beyond the drain's own next run — a failed delivery is visible (`failed`,
with the status code) and re-raising the same rule condition is how it would fire again, the same
answer `AUTO_OVERDUE` already gives for a notification that failed once.

## What would send this back

- **One webhook per tenant is a real limit, not an oversight.** A firm wanting Slack AND a
  ticketing system both notified needs `WebhookConfig` to become a real list (`id` stops
  defaulting to `"default"`), and rules need a way to address a specific one — not designed here
  because nothing in the gap survey asked for more than one destination.
- **No SSRF hardening beyond the trust boundary stated above.** If a firm's threat model includes
  an admin account being compromised specifically to pivot outbound requests at internal
  infrastructure, this design is not enough — it would need a private-IP-range block on the
  configured URL at save time, which is a deliberate scope decision to add later, not an
  oversight to fix quietly.
- **If a receiving system needs its own retry/backoff contract** (Slack's rate limits, for
  instance) — this design sends once per drain pass and stamps failed; anything more needs a
  queue with backoff, which is a different piece of infrastructure than a drain that runs after a
  scheduled pass.
