# Giving a client person access

A guest sees exactly one thing: **their own client's marked content** — the records, notes
and files somebody deliberately made client-visible, under their client's branch of the
tree, and nothing else. The withholding happens on the server, in the payload; a guest's
browser never receives what it must not show. Everything else — every other client, every
internal record, rates, time, estimates, SoWs — is absent, not hidden.

## The three steps

### 1. Invite them into the tenant (an Entra admin action)

Entra admin center → **Users → New user → Invite external user** — the invited address is
the one they will sign in with, and the one the directory is joined on. (Or via Graph:
`POST /invitations` with `invitedUserEmailAddress` and the app URL as
`inviteRedirectUrl`.) They accept the invitation once; from then on they sign in at the
app's normal Sign in with their own credentials — the app's single-tenant authority
accepts the tenant's B2B guests as members.

### 2. Give them a seat (Configuration → Roles & people)

Add the person: their name, the **invited email exactly**, one of the three client roles
(Client Sponsor / Client Process Lead / Client User), and — the part that scopes
everything — the **Client** column set to their client. The select says it plainly: a
client seat that is "not attached — sees nothing". That is deny-by-default working, not a
bug: an unattached seat and an unknown sign-in both get an empty workspace, with the
banner saying which case it was.

### 3. Mark what they should see

Nothing is client-visible by default. On a record's Overview: **Show to client**; per note
in the composer or per existing note; per stored file in the evidence panel. What was said
to the client by mail is the one thing marked automatically. Everything marked wears the
`Client-visible` chip so the line is legible at a glance — and a client's own submissions
(the request form, intake mail) are born visible to them.

## What a guest can do

Whatever the three client roles grant — raise work (born client-visible), add notes,
read what is marked. Nothing they write can widen their view: the scope is on their
directory entry, the withholding on the server, and the reducer refuses `internal.view`
on client roles outright ("the client boundary is the point").

## Troubleshooting

- **Guest sees an empty workspace** — read the banner. "Not attached to a client yet" →
  set the Client column on their directory entry. "Matches no directory entry" → the
  directory email does not equal the invited address (check for typos; the join is
  email-first, exact, case-insensitive).
- **Guest sees a record but not its notes/files** — notes and files carry their own flags;
  mark them individually.
- **The sign-in works but the token carries no email** — some guest tokens carry only the
  `#EXT#` UPN. Verify against a real guest before building a workaround (checklist §32);
  the normalization lands in the auth callback only if a real token needs it.
