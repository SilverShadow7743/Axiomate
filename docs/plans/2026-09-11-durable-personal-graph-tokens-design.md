# Durable personal Graph tokens — the RAM-only posture, reversed

*11 September 2026. Design and plan in one document, because the change is small in code and
large in posture, and the posture is the part worth reading.*

## The decision, and whose it is

Nishant, on seeing "Your inbox" ask for a reconnect straight after a deploy: *"There should be
a way to connect to your inbox without reconnecting."* That is a decision on the fork the
31 Aug in-mail design chose the other way (tokens never at rest) and the 8 Sep scheduled-reply
design named as Option A and declined to take on its own authority. Operating principle 6 —
escalate decisions requiring executive judgement — is why it waited; it is now taken.

## What changes, exactly

- The **refresh token** — and only the refresh token — is written to a new `PersonalGraphToken`
  row (tenant, Entra oid, ciphertext, updated-at), one per person. Access tokens stay RAM-only;
  they live an hour and are re-acquired from the refresh token on a cache miss.
- The ciphertext is **AES-256-GCM** under a 32-byte key derived by HKDF-SHA256 from
  `AXIOMATE_SESSION_SECRET` with a purpose-specific info string (`lib/tokenCrypto.ts`). No new
  secret to provision: the one secret the app already cannot run without becomes the root of
  this key too. Rotating it invalidates every stored token — one reconnect per person — which
  is the right consequence of rotating it.
- **Fail-closed to the old behaviour.** No database, or no usable session secret, and the
  cache is exactly the RAM-only map it was. A database error on store, load or delete is logged
  and the person sees "reconnect", never an error page.
- **A dead token is not kept.** When Entra answers a refresh with 400 (`invalid_grant`:
  revoked, expired, consent withdrawn), the row is deleted. A 5xx or a throttle keeps it for the
  next attempt.
- The **single-instance assumption** the cache carried is gone: a second instance loads the
  same row on its first miss. Entra keeps the previous refresh token valid after rotating it,
  so two instances rotating in turn do not lock each other out.

## What a reader of the database now sees

Ciphertexts that open only with the session secret, which is in App Service configuration and
not in Postgres. The in-mail design's line — *"nothing at rest to leak from a backup"* — becomes
*"nothing at rest that opens without a secret the backup does not hold."* Named plainly rather
than softened: this is weaker than never storing it, and it is the trade Nishant chose so a
deploy stops costing every person their inbox.

## Plan

**1. `lib/tokenCrypto.ts`** — pure: `deriveTokenKey`, `encryptSecret`, `decryptSecret`. **Proven
first** by scenario `TOK1`: round trip; two seals of one input differ (fresh IV); a tampered
ciphertext, a wrong key and an unknown version prefix all open as `null`, never as text.
Verify: `npx tsx scripts/scenario-validation.ts` — `TK1 PASS`.

**2. `prisma/schema.prisma` + migration `20260911000001_personal_graph_tokens`** — the table,
composite key `(tenantId, oid)`, RLS policy in the creation migration. Verify: `npx prisma
generate`, `npx tsc --noEmit`.

**3. `lib/db/personalGraphTokens.ts`** — the store: seal on sign-in, load-and-exchange on a
cache miss, re-seal on rotation, delete on `invalid_grant`. Every Prisma call names
`tenantId` and runs under `withTenant` (`npm run audit:tenancy`). **The detail most likely to be
got wrong:** a cache miss must load the refresh token and *force* the exchange — the entry is
seeded with an empty access token and an expiry of zero so the ordinary refresh path runs, not
a new code path. **The step carrying the most regression risk:** this file is read by every
personal-Graph route; if `getPersonalGraphToken` throws instead of returning `null`, every one
of them becomes a 500 rather than a "reconnect". The guard is that every database call is
inside its own try, reported to the log, and the function's contract stays `string | null`.

**4. `app/api/auth/callback/route.ts`** — `await` the store (it swallows its own failures; the
existing try stays as the belt to that brace).

**5. Live.** Sign in once (the row appears), then restart the app — or wait for the next
deploy, which is the same event — and open "Your inbox": it lists messages with no reconnect.
That is the whole of the acceptance test, and it is the thing that failed on 11 Sep at the
I17 verification.

## Commits

One commit: the migration cannot ship without the store that fills the table, and the store
is inert without the migration. Docs ride with it.

## What would send this back

- If Entra does **not** keep the previous refresh token valid after rotation — surfaces at
  step 5 on a two-instance deployment as alternating reconnects. Then the store needs a
  per-row version and a compare-and-set, which is a design change, not a patch.
- If the session secret is an unresolved Key Vault reference on a fresh deployment (the case
  `lib/auth/cookie.ts` documents) — `secretValue` refuses it, `durable()` is false, and the
  behaviour is RAM-only. Not a send-back; named so nobody reads a missing row as a bug.
