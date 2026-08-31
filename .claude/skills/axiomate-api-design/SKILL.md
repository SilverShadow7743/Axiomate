---
name: axiomate-api-design
description: This skill should be used when designing or reviewing an Axiomate TMS API route — request/response shape, validation, error handling, authorization, tenant boundaries, versioning. It supplies the real conventions already established (app/api/workspace/route.ts's allowlist validation, idempotency keys, optimistic-client pattern) so a new route matches the existing API philosophy instead of inventing a new one.
---

# Axiomate API Design

One real, worked example already answers most API design questions here:
`app/api/workspace/route.ts` — the workspace write endpoint. Its conventions are the standard,
not a starting point to reconsider each time.

## The real conventions

1. **Allowlist, never a denylist.** `KINDS` is an explicit `Set` of accepted action kinds —
   "anything else is refused rather than guessed at" (the route's own comment). A new action
   type is invisible to the endpoint until explicitly added to the allowlist; there is no
   default-accept path.
2. **Explicit bounds.** `MAX_BATCH = 200` — "a queue drain should never be unbounded; anything
   larger is a client bug, not a workload." Any new endpoint accepting a collection needs a
   stated, deliberate cap, not an implicit one from whatever the database happens to tolerate.
3. **Idempotency keys** — `lib/idempotency.ts`'s `keyProblem`/`SubmittedAction`. A write that
   could be retried (network failure, client resend) is checked against a key before being
   replayed twice. New mutating routes should use the same mechanism rather than relying on the
   client to avoid double-submission.
4. **Tenant and actor resolved server-side, always.** `currentTenantId()` (`lib/tenant.ts`) and
   `getSession()`/`identityEstablished()` (`lib/principal.ts`) — never trusted from the request
   body. Per `axiomate-tenant-isolation`/`axiomate-security-review`: a route that reads a tenant
   or actor id from the client payload rather than the resolved session is a real defect, not a
   style choice.
5. **The optimistic-client, confirming-server pattern.** The client has already applied the
   action optimistically; the server call is a confirmation, not something the UI blocks on. If
   the reducer refuses (stored state moved on), the response says so and the client refetches
   rather than silently drifting out of sync with the server. New mutating endpoints should
   follow this shape when the client can reasonably apply the change optimistically — not every
   endpoint needs it (a report-generation endpoint has nothing to optimistically apply).
6. **Route configuration is explicit** — `export const runtime = 'nodejs'`, `export const
   dynamic = 'force-dynamic'` stated directly rather than left to Next.js defaults, so caching
   behavior for a write endpoint is a deliberate choice, not an accident of framework defaults.

## Designing a new route

1. What's the request shape, and is it validated against an allowlist (of kinds, of fields) or
   left open? Open acceptance is the exception, not the default — justify it if chosen.
2. Does this route write data? If so: tenant/actor resolution (server-side), idempotency
   (if retriable), and the `can()` gate (`axiomate-security-review`) all apply.
3. Is this a batch operation? State the cap explicitly.
4. Can the client apply this optimistically? If yes, follow the confirm-or-refetch pattern
   rather than making the UI wait on the round trip.
5. Error responses — the reducer's own refusal messages already carry the "teaching message"
   convention (`axiomate-domain-analysis`'s access-gate pattern); surface those through the API
   response rather than replacing them with a generic HTTP error code and no explanation.
