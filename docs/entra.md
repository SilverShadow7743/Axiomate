# Signing in with Microsoft Entra ID

The registration, what it asks the firm's people for, and the two things about a first rollout
that surprise everybody.

The application already implements sign-in. `lib/auth/entra.ts` runs the authorisation-code flow
with PKCE, redeems the code server to server, and verifies the id token against Entra's published
keys — issuer, audience, expiry and the nonce this server generated. None of that is configured
here. This document is about the *registration* in the directory that makes it work, and about
what happens on the other side of a successful sign-in, which is the part that goes wrong.

---

## What the registration is for

Axiomate does not hold passwords. There is no login form, no password reset and no lockout policy,
deliberately: that is a security subsystem in its own right and the firm already runs a directory
that knows who has left — which is the fact a delivery tool most needs and is worst at being told.

The registration is the entry in `axiocloudsolutions.com` that lets Axiomate ask Entra "who is
this, and is it really them". It gives the deployment four values:

| Value | What it is |
| --- | --- |
| `AXIOMATE_ENTRA_TENANT_ID` | The directory. Every authority URL is built from it. |
| `AXIOMATE_ENTRA_CLIENT_ID` | Which application is asking. Also the audience the id token is checked against. |
| `AXIOMATE_ENTRA_CLIENT_SECRET` | How the server proves it is that application when it redeems the code. |
| `AXIOMATE_ENTRA_REDIRECT_URI` | Where Entra is allowed to send the browser back. |

Set all four and sign-in is enforced: unverified requests to the write endpoint are refused, and
each person's roles are resolved from the directory rather than from the fallback. Leave any of
them empty and the application keeps running as the single configured operator — a deployment
without credentials should work rather than present a login it cannot satisfy.

There is a fifth value that is not an Entra value and is the most common reason a correct
registration still fails. `AXIOMATE_SESSION_SECRET` signs the session cookie, and
`lib/auth/cookie.ts` refuses to sign without it. Without that secret the round trip to Entra
succeeds and the callback then throws on the last step. Generate one with `openssl rand -base64 48`
and use a different one in every environment.

---

## Creating it

```
node scripts/entra-register.mjs http://localhost:3000/api/auth/callback --new-secret
```

You need the Azure CLI and a signed-in session with permission to manage applications —
Application Developer is enough to create one; Application Administrator or Cloud Application
Administrator is needed to grant consent.

```
az login --tenant axiocloudsolutions.com
```

The script finds the registration by display name and updates it if it is already there, so it is
safe to run again. It refuses before creating anything if `az` is missing, if nobody is signed in,
or if the signed-in session is in a different tenant from the one named — a registration created in
the wrong directory succeeds quietly and then fails at the first sign-in with an error about the
user account not existing, which is a confusing afternoon.

It prints the tenant id and client id it used, so both can be checked against
**entra.microsoft.com → App registrations** before anything is deployed.

### What it runs

| Step | Command |
| --- | --- |
| Check the CLI is there | `az version` |
| Check who is signed in, and where | `az account show` |
| Resolve the three permission ids from this tenant's Graph service principal | `az ad sp show --id 00000003-0000-0000-c000-000000000000` |
| Find an existing registration | `az ad app list --display-name Axiomate` |
| Create it | `az ad app create --display-name Axiomate --sign-in-audience AzureADMyOrg --web-redirect-uris <uri> --enable-id-token-issuance false --enable-access-token-issuance false --required-resource-accesses @<file>` |
| Or update it in place | `az ad app update --id <appId> --web-redirect-uris <every uri> --sign-in-audience AzureADMyOrg --enable-id-token-issuance false --enable-access-token-issuance false --required-resource-accesses @<file>` |
| Read back what is registered | `az ad app show --id <appId>` |
| Create the Enterprise application entry | `az ad sp create --id <appId>` |
| Mint a secret, with `--new-secret` | `az ad app credential reset --id <appId> --append --display-name axiomate-<date> --years 1` |
| Grant tenant-wide consent, with `--admin-consent` | `az ad app permission admin-consent --id <appId>` |

`--append` on the credential command is not optional. Without it, `credential reset` does what its
name says and clears every existing password on the registration — which, on a live deployment, is
an outage caused by a script that was only meant to add something.

### Why it prints the values instead of writing them

The four values go to stdout and nowhere else. That is a deliberate refusal, for three reasons in
increasing order of weight. The script cannot know which environment is being configured, and the
deployed host's secret does not belong in a developer's working copy. `.env` is a file a person
edits, and a script that rewrites it eventually destroys a value somebody typed. And a secret
written to disk stays written: it survives in the file, in the editor's undo history, and in
whatever backup ran next. Printed, it exists in one terminal, and the operator decides where it
lands — which for anything but a laptop should be a secret store.

### What it asks for, and why it is only three things

Delegated Microsoft Graph permissions: `openid`, `profile`, `email`. Nothing else.

That is checked against the application rather than assumed. `beginSignIn` in `lib/auth/entra.ts`
sets `scope` to exactly `openid profile email`, and `completeSignIn` sends the same three when it
redeems the code. `readIdentity` then reads three claims and stops — `oid`, `name` and `email`
(falling back to `preferred_username`). There is no Graph call anywhere in the codebase, so no
access token is ever used for anything, so no fourth permission could be exercised even if it were
granted. `User.Read` in particular is *not* requested, although it is what the portal offers by
default and what most registrations end up carrying.

The three permission ids are resolved from the tenant's own Graph service principal at run time
rather than hardcoded. They are stable and could have been written down; resolving them means the
script cannot ship a mistyped GUID and request the wrong permission, which is the kind of mistake
that survives review because a GUID looks correct for exactly as long as nobody checks it.

---

## Consent: who is asked, and is admin consent needed

**No. Admin consent is not required.** `openid`, `profile` and `email` are the OpenID Connect
scopes, and they are user-consentable: any member of the directory can grant them for themselves.
Each person sees one consent prompt the first time they sign in to Axiomate and never sees it
again, because the grant is recorded against their account.

Two qualifications, both worth knowing before the rollout.

**If the tenant has disabled user consent**, nothing is user-consentable, including these three. In
**Entra admin centre → Enterprise applications → Consent and permissions → User consent settings**,
if the setting is *Do not allow user consent*, then the first person to try will see "Need admin
approval" and will not be able to proceed. That is a tenant-wide policy decision, not something
about this application. Check it before the rollout rather than discovering it from the first
person who tries.

**An administrator can consent once for everybody**, which is usually what a firm wants for an
internal tool. Run the script with `--admin-consent`, or use
`az ad app permission admin-consent --id <clientId>`, or use **Grant admin consent for
axiocloudsolutions.com** on the API permissions page. This needs Cloud Application Administrator,
Application Administrator or Global Administrator — Privileged Role Administrator is only needed
for application permissions, and this registration has none. After it, nobody is prompted at all.

One thing not to promise anyone: the wording of the consent screen will not map one-to-one onto the
three scope names. Microsoft groups and rewords them — "Sign you in and read your profile", "View
your basic profile", "View your email address" — and "Maintain access to data you have given it
access to" appears on the prompt in flows that never asked for `offline_access`. If somebody
forwards a screenshot asking why it says more than three things, that is why. It does not mean the
registration is asking for more than it should; check
**Enterprise applications → Axiomate → Permissions** for what was actually granted.

---

## Adding a second redirect URI later

Localhost and the deployed host can both be registered. Run the script again with the other URI:

```
node scripts/entra-register.mjs https://axiomate.example.com/api/auth/callback
```

It reads the URIs already registered, adds the new one, and writes back the union. This is the
whole reason the script exists rather than a single `az` command: `az ad app update
--web-redirect-uris` **replaces** the list, so the obvious one-liner deletes whatever was there.
That is how a deployment loses its production redirect on the day somebody sets up a local
environment.

Do not pass `--new-secret` when you are only adding a URI. Each run with that flag appends another
live credential.

Two things about redirect URIs that produce confusing failures:

- They are compared exactly, including case in the path and including the trailing slash. A
  mismatch is `AADSTS50011`, and the message says the redirect URI does not match — believe it,
  because the value in `AXIOMATE_ENTRA_REDIRECT_URI` must be character-for-character what is
  registered, not merely equivalent.
- Only `localhost` may use plain `http`. Everything else must be `https`.

To see what is registered now:

```
az ad app show --id <clientId> --query "web.redirectUris"
```

---

## Nobody has roles on first sign-in

This is the difference between a working rollout and a firm that either cannot use the tool or is
all administrators. Read it before the first person signs in, not after.

### What actually happens

`rolesFor` in `lib/access.ts` looks the signed-in person up in the operating model's people
directory. If it finds nobody, or finds somebody who has been assigned no live role, it returns
`model.access.defaultRoleIds` — and `defaultAccessPolicy()` ships that as `[ROLE_ADMIN]`.

So on a fresh deployment with Entra switched on, the first person to sign in becomes an
Administrator with all twenty-six permissions. It looks like a completely successful rollout, which
is exactly why nobody investigates it.

They are not the only one. The registration is single-tenant (`AzureADMyOrg`), so anybody in
`axiocloudsolutions.com` can complete a sign-in, and every one of them gets the same fallback. The
comment in `lib/access.ts` anticipates this and says so plainly: *"On the day a login exists, that
field should become empty and every real person should carry real roles."* That day is the day the
four `AXIOMATE_ENTRA_*` values are set.

If you want Entra itself to restrict who may even reach the application — rather than everyone
reaching it and landing on a fallback role — set **Enterprise applications → Axiomate →
Properties → Assignment required** to *Yes* and assign the delivery team. That is a directory
control and it is independent of everything below.

### What the administrator must do, in this order

The order matters. Doing step four first is what locks a firm out.

1. **Make the join work for yourself.** See the next section. Until it does, you are an
   administrator only by accident of the fallback.
2. **Give yourself a role that includes `config.manage`.** In **Configure → Roles & people**,
   assign yourself Administrator, or Engagement Lead, which is the only seeded delivery role that
   carries `config.manage`.
3. **Sign out, sign in, and confirm the Configure screen still opens.** This is the check that
   proves step one worked. If it opens because the fallback is still Administrator, you have not
   tested anything.
4. **Assign everybody else a role**, then and only then **empty the fallback** on the Permissions
   screen.

### Why step four is the dangerous one

`accessProblems` refuses a policy that would leave nobody able to configure the platform, and it is
worth knowing exactly how far that check reaches, because it is narrower than it looks. It refuses
when no role at all grants `config.manage`, and it refuses when *nobody in the directory holds any
role whatsoever* and the fallback cannot configure.

It does not refuse the case in between. Assign one person `ROLE_CLIENT_USER`, then empty the
fallback, and the check passes — a role is held, so the "nobody holds a role" condition is false —
while in fact nobody holds `config.manage`.

At that point the Configure screen is gated by a permission nobody has, and the screen that could
undo the change is the screen the change locked. Posting the action directly does not help either —
the reducer checks `config.manage` on every configuration action regardless of where it came from,
which is the correct design and is why this is not a hole. Nor does turning Entra off rescue it:
unset the `AXIOMATE_ENTRA_*` values and the configured operator resolves through the same
`rolesFor`, matches nobody, and receives the same empty fallback. Recovery means editing the stored
operating model in the database by hand.

Confirm you can still open Configure before you sign out.

---

## How a signed-in person is matched to the directory

A verified session is not the same thing as a recognised person. The join between them is the thing
to get right, and the field is not the one the interface suggests.

### What the code does

`rolesFor` tries three matches in order, on an actor whose `id` is the Entra object id and whose
`name` is the Entra display name:

1. **Directory key** — a person whose `id` equals the object id. Person ids are generated by the
   reducer as `PERSON_1`, `PERSON_2` and so on, and there is no way through the application to set
   one to a GUID. This never matches an Entra sign-in.
2. **Address** — a person whose `email` equals the actor's *id*. For an Entra session the actor's
   id is the object id, so this compares an email address to a GUID and never matches. It is live
   in the other mode: with Entra off, the actor's id is whatever `AXIOMATE_OPERATOR` is set to, so
   setting that to an address does match a person's email.
3. **Display name** — a person whose `name` equals the actor's name, ignoring case.

**So the field that must be filled in is Name.** The person's entry in **Configure → Roles &
people** must have a name equal, ignoring case, to their Entra display name — the `name` claim,
which is what appears next to them in Teams and Outlook. Get that right and their assigned roles
apply. Get it wrong, or leave them out of the directory, and they silently fall back to
`defaultRoleIds`: they are signed in, verified, correctly attributed in the audit trail, and
carrying whatever the fallback says rather than what anybody assigned them.

The email field on the same screen is the *intended* join — the code that stores it says so, and it
enforces that two people cannot share an address for exactly that reason — but it is not the field
that is compared for a signed-in person today. Filling it in is worth doing and it will not, on its
own, make anybody recognised. This is on the decisions list below.

### The harder half: people who are not in the directory

The directory is seeded entirely from names discovered in the imported issue log — `initModel`
takes the owners it finds and creates a person for each, with no roles, because the log records who
worked an issue and never records what they are.

The Configure screen edits those entries and has no control for adding one: all three of its
`upsertPerson` calls pass an existing person's id. The reducer itself does support it — the action
takes `id: string | null`, and a null id generates a new `PERSON_<n>` — so somebody signed in with
`config.manage` can create a directory entry by posting the action to `/api/workspace` directly:

```json
{ "t": "config", "op": { "k": "upsertPerson", "id": null, "name": "Jane Okafor",
  "roleIds": ["ROLE_PROJECT_MANAGER"], "email": "jane.okafor@axiocloudsolutions.com" },
  "now": "2026-08-16T09:00:00.000Z" }
```

That is a workaround, not a feature. The name in it must match the person's Entra display name
exactly, for the reason above, and nothing in the interface will tell you if it does not.

The practical consequence for a rollout: a new joiner, or a partner who never worked a logged
issue, or an administrator who came from the finance side, is not in the directory and cannot be
given a role from any screen. They will sign in successfully and resolve to the fallback, whatever
it has been set to — Administrator today, nothing at all once step four above has been done. Check
the directory against the list of people who need access *before* emptying the fallback, because
the workaround above needs somebody who still holds `config.manage`.

---

## When the secret expires

It will. The script defaults to one year, and Microsoft caps client secrets at twenty-four months.

### What it looks like

`completeSignIn` posts the code to Entra's token endpoint with the client secret. When the secret
has expired, that call fails and the provider's own message is passed through:

```
Entra refused the code exchange (401). AADSTS7000222: The provided client secret keys for app
'<client id>' are expired.
```

**AADSTS7000222** is the code to search for, and it means expired specifically. Its near neighbour
**AADSTS7000215**, "Invalid client secret provided", is a different fault: a secret that is wrong
rather than out of date — most often because the secret *id* was copied instead of the secret
*value*, or because the value was truncated on the way into the environment. If a rotation was just
deployed and sign-in broke, expect 7000215, not 7000222.

The callback then redirects the browser to `/?auth_error=<that message>`.

### What a person actually sees

Very little, which is the problem. They click **Sign in**, are taken to Microsoft, authenticate
successfully — often without being prompted at all, because single sign-on has them already — and
are returned to Axiomate, where they are looking at the same page they started on with the **Sign
in** button still there. The reason is in the address bar, in a query parameter nothing on the page
renders. To them it reads as "the sign-in button does nothing".

The blast radius arrives gradually rather than all at once, because sessions last eight hours.
Nobody can sign in from the moment the secret expires, but everybody who signed in earlier that day
keeps working normally until their cookie runs out. So it presents as a handful of people reporting
a broken sign-in button, spreading through the day, with the application apparently working fine
for whoever is asked to check.

Anyone still holding a valid session can read and can write. Anyone without one can read and cannot
write: the workspace endpoint returns *"Sign in to make changes."*

### Confirming it

```
az ad app show --id <clientId> --query "passwordCredentials[].{name:displayName,expires:endDateTime}"
```

The script prints the same list, with days remaining, every time it runs.

---

## Rotating the secret

Rotation is the same command as creation, which is the point.

1. **Mint the new one.** `node scripts/entra-register.mjs <the deployed redirect uri> --new-secret`.
   It appends; the existing secret keeps working, so there is no window in which sign-in is broken.
   The value is printed once and Entra cannot show it again.
2. **Deploy it** as `AXIOMATE_ENTRA_CLIENT_SECRET` and restart. `entraConfig()` reads the
   environment on every call rather than at module load, so a restart is all that is needed.
3. **Confirm a real sign-in works** — sign out fully and back in, do not rely on an existing cookie,
   which will keep working regardless of whether the new secret is right.
4. **Delete the old one.** Two live secrets means an expiry can pass unnoticed, because the
   application keeps working on the other one until that one goes too.

   ```
   az ad app credential delete --id <clientId> --key-id <key id>
   ```

Rotate on a diary date rather than on an alert. There is no alert: the first notification of an
expired secret is a person saying the sign-in button does nothing.

A shorter secret life is safer and rotated more often; a longer one is forgotten. Twelve months is
the compromise this script defaults to and it is a decision the firm can revisit — Microsoft's own
recommendation is under twelve. The better answer for a deployment in Azure is a certificate or a
federated credential, neither of which expires the way a password does, and neither of which this
script sets up. That is on the decisions list.

---

## Decisions the firm needs to make

1. **Tenant-wide admin consent, or a prompt per person.** Consent is not required from an
   administrator, so this is a choice, not an obstacle. Granting it once suppresses the prompt for
   everybody and is the usual answer for an internal tool. Leaving it means each person sees one
   screen once and can decline it.
2. **Who may sign in at all.** Every member of `axiocloudsolutions.com` can complete a sign-in
   today. If that is not intended, turn on *Assignment required* on the enterprise application and
   assign the delivery team. This is a directory decision and cheap to make now.
3. **What the fallback role should be, once the rollout is done.** The choice is between empty —
   nothing at all until somebody is assigned, which is safe and means a new person can do literally
   nothing until an administrator acts — and a low-privilege fallback. There is no read-only role in
   the seeded set, so a low-privilege fallback would have to be created. Leaving it as Administrator
   is the one answer that is definitely wrong once real people are signing in.
4. **How people who are not in the imported log get into the directory.** The Configure screen has
   no control for adding a person, although the reducer supports it, so today the answer is an
   action posted by hand. Whether that stays the answer or the screen grows an *Add person* control
   is a decision — and either way somebody must still hold `config.manage` to do it, so it has to
   be settled before the fallback is emptied.
5. **Whether the join should be on email rather than display name.** Matching on display name is a
   join on a field two people can share and one person can change on a whim. The email field exists
   for exactly this and is not currently what is compared for a signed-in person, so the intended
   join and the actual one have diverged. Changing that is a change to `lib/access.ts` — out of
   scope for this setup, in scope for the firm to ask for.
6. **Secret lifetime, or no secret at all.** One year is the default here. A certificate or a
   federated credential removes the expiry failure described above entirely and is the right answer
   if the deployment runs in Azure.
