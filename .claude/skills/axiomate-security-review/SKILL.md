---
name: axiomate-security-review
description: This skill should be used when reviewing Axiomate TMS code or configuration for authentication, authorization, RBAC, tenant-isolation, IDOR, input-validation, secrets-handling, or audit-logging issues. It supplies the real, already-implemented mechanisms (sealed-cookie sessions, the can() permission gate, dual-layer tenant isolation, actor attribution) so review checks the actual implementation rather than a generic security checklist.
---

# Axiomate Security Review

Every mechanism below is real and already implemented — this skill's job is checking new work
against them, not proposing new security infrastructure.

## Authentication

Entra sign-in (`lib/auth/entra.ts`), resolved server-side. Sessions are `lib/auth/seal.ts`'s
HMAC-signed (not encrypted) cookie, carrying exactly `{oid, name, email, exp}` — nothing else.
**Check:** does new code trust anything from the client beyond what the sealed session already
verified? A request body claiming an identity the session doesn't back is the classic mistake.

## Authorization — RBAC via one gate

`can(model, actor, key)` (`lib/access.ts:372`) is the SINGLE permission check. `!model.access
?.enforced` short-circuits to allow-all — config-driven, never a hardcoded bypass in application
code. **Check:** does a new write path call `can()` before mutating, or does it assume the UI
already prevented the action (never sufficient — the UI is not the security boundary)?

## Tenant isolation / IDOR

The two-layer mechanism in `axiomate-tenant-isolation` (app-layer `withTenant()` discipline +
database-layer RLS with `FORCE ROW LEVEL SECURITY`) IS this codebase's IDOR defense — a request
for another tenant's record id fails at the database layer even if application code has a bug.
**Check:** does a new route accept a raw id from the client and fetch it WITHOUT the tenant
context already active? That's the shape an IDOR gap takes here specifically.

## Input validation

**Check per new form/API surface**, not generically: does the reducer/route validate shape and
business rules before writing (the reducer's own validators — e.g., `validateChange`'s
date-ordering check, `canParent`'s placement law) rather than trusting client-side validation
alone? Client validation is UX, not the security boundary, exactly like authorization above.

## Secrets

Read via `process.env.*` at the point of use (`lib/auth/entra.ts`, `lib/db/client.ts`,
`lib/storage/graph.ts`, others) — never hardcoded, never logged. **This project's own standing
rule, learned from a real incident this session:** a credential pasted into a chat transcript
must be treated as compromised and rotated once the immediate need is done, even though nothing
external saw it — the transcript itself is the exposure. Never print a secret's value in any
context (logs, chat, commit messages) — length/prefix-only verification is the pattern to
follow when confirming a secret is set.

## Audit logging — attribution, not a separate log

Every write names its actor; `audit:attribution` (`scripts/attribution-proof.ts`) proves audit
trails differ between two actors performing the identical action. There is no separate security
audit log — the domain's own History/audit trail (visible per-record, per
`axiomate-domain-analysis`'s attribution invariant) IS the audit log. **Check:** does a new
write path pass its actor through to whatever ends up in that trail, or does it default to a
system actor that would make the real actor unrecoverable later?

## Process

Review order: authentication trust boundary → `can()` gate presence → tenant isolation (both
layers) → input validation at the write boundary → secrets handling → actor attribution. Rank
findings BLOCKER when a check is MISSING entirely (no `can()` call on a write, a route trusting
a client-supplied tenant/actor), not just when an existing check is imperfect.
