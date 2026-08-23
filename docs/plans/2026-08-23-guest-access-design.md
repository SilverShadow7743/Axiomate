# Guest access — design

**Date:** 2026-08-23 · **Phase:** 7 of the Hive gap program · **Status:** approved

## The finding that makes this urgent

The client boundary shipped BINARY: any signed-in tenant member without `internal.view` —
including a guest matching no directory entry — receives the client view of EVERY client's
marked content. Only test data is marked today, so nothing has leaked; phase 7 closes the
hole before a real guest exists.

## What already works

Entra B2B guests of the tenant authenticate against the existing tenant-specific authority
— no auth change. The callback's email claim joins them to the directory (`rolesFor`
email-joins; the directory screen edits emails). A client-role reader already receives
`clientView`, proven by CB1 and the payload proof. The marking surfaces shipped in #2.

## The design

### 1. The person gains a home

`Person.clientScopeId?: string | null` — the CLIENT NODE id this person belongs to.
Carried by `upsertPerson`; edited on Roles & people, shown only for people holding a
client role. No migration — the directory rides the model document.

### 2. The scope in the withholding

`clientView(state, clientScopeId)` filters the surviving records to the SUBTREE of the
reader's client node — marked records whose ancestor chain passes through it, the chain
itself for placement, nothing beside it. Three fail-safes, all deny-by-default and loud:

- Client-role reader, **no scope set** → an empty view, and the boot banner says why:
  "Your seat holds a client role but is not attached to a client yet — ask the firm to set
  it on your directory entry."
- Signed-in reader matching **no directory entry** → an empty view. (The fix for the live
  finding.)
- Internal readers with `internal.view` — untouched.

### 3. The runbook

`docs/guest-access.md`: invite the guest (Entra portal → External users, or Graph), then
the directory entry — name, the INVITED email, a client role, the client scope. The
`#EXT#` UPN wrinkle is checked against a real guest token in the checklist and built only
if that token carries no clean email claim.

### 4. Proofs

Scenario **GA1**: an OAPIL-scoped client reader sees OAPIL's marked content and none of
another client's; unscoped client-role → empty; internal unchanged; the ancestor chain
kept and sibling branches absent. CB1 and the persistence payload proof updated for the
scoped signature — the payload case passes the marked record's own client so the scoped
path is what the string is checked against.

### 5. The verification, with a real guest

Checklist §32: the operator invites nishant.ax@gmail.com as a B2B guest (an admin action),
the directory entry is created (client role, OAPIL scope), and the guest signs in from a
separate browser profile to see only OAPIL's marked records.

## Rejected

- **Scoping by email domain** — fragile and spoofable by a typo in the directory.
- **A separate guest portal** — a second UI to maintain; the existing screens already
  survive an emptied state.

## What would send this back

- A person legitimately belonging to SEVERAL clients — the field becomes a list; cheap
  now, said out loud.
- Per-engagement rather than per-client scoping.
