import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Create or update the Entra ID app registration that Axiomate signs in against.
 *
 *   node scripts/entra-register.mjs http://localhost:3000/api/auth/callback
 *   node scripts/entra-register.mjs https://axiomate.example.com/api/auth/callback --new-secret
 *
 * ---------------------------------------------------------------------------
 * What this is, and what it is not
 *
 * The application already implements sign-in — `lib/auth/entra.ts` runs the authorisation-code
 * flow with PKCE and verifies the id token against Entra's published keys. Nothing here is new
 * authentication code. This is the registration on the directory side that makes the existing
 * code work: an application object, a redirect URI, three delegated permissions, and a secret.
 *
 * It shells out to `az` rather than calling Microsoft Graph over HTTPS directly. Graph would
 * mean this script owning a token acquisition of its own — a second, unverified copy of the
 * thing `lib/auth/entra.ts` already does carefully — so that a setup script could avoid a
 * dependency the operator installs once. The CLI already holds the operator's credentials, is
 * already how a person would do this by hand, and fails with the provider's own error text.
 *
 * ---------------------------------------------------------------------------
 * Why it asks for openid, profile and email, and for nothing else
 *
 * Checked against the application rather than assumed. `beginSignIn` in `lib/auth/entra.ts`
 * sets `scope` to exactly `openid profile email`, and `completeSignIn` sends the same three
 * when it redeems the code. `readIdentity` then reads three claims and no more — `oid`, `name`,
 * and `email` (falling back to `preferred_username`). There is no Graph call anywhere in the
 * codebase, so no access token is used for anything, so no other permission would ever be
 * exercised. A scope requested is a permission somebody has to justify at the next review, and
 * `User.Read` — which is what most registrations end up carrying because it is the default the
 * portal offers — would be a permission this application never uses.
 *
 * The three permission ids are resolved from the tenant's own Microsoft Graph service principal
 * at run time rather than written here as constants. They are stable and could have been
 * hardcoded; resolving them means the script cannot ship a stale or mistyped GUID and quietly
 * request the wrong permission, which is a failure that would survive review because a GUID
 * looks correct exactly as long as nobody checks it.
 *
 * ---------------------------------------------------------------------------
 * Safe to run twice
 *
 * The registration is found by display name and updated in place, so a second run adds the
 * deployed redirect URI to the one that is already there rather than replacing it. That merge
 * is deliberate and is the trap in this whole exercise: `az ad app update --web-redirect-uris`
 * *replaces* the list, so the obvious one-line update would silently delete localhost, or
 * delete production, depending on which run happened last.
 *
 * A secret is the one thing that is not created on every run. Minting one each time would leave
 * a drift of live credentials on the registration and print a value the operator may not
 * actually deploy, so it takes `--new-secret`. That flag is also the rotation procedure — see
 * `docs/entra.md`.
 */

/* ================================================================== *
 * Arguments
 * ================================================================== */

const GRAPH_APP_ID = '00000003-0000-0000-c000-000000000000'
const SCOPES = ['openid', 'profile', 'email']
/** The path `app/api/auth/callback/route.ts` is served from. A URI that misses it cannot work. */
const CALLBACK_PATH = '/api/auth/callback'

const argv = process.argv.slice(2)

/**
 * Parsed by hand, and the parsing knows which flags take a value.
 *
 * Anything that does not is a positional, and the redirect URI is the only positional there is.
 * The naive version — "the first argument that does not start with a dash" — reads
 * `--name Axiomate` as a request to register `Axiomate` as a redirect URI, which fails much
 * later and blames the wrong thing.
 */
const TAKES_VALUE = new Set(['--name', '--tenant', '--secret-years'])
const options = new Map()
const positionals = []
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]
  if (!arg.startsWith('-')) {
    positionals.push(arg)
  } else if (TAKES_VALUE.has(arg)) {
    i += 1
    if (i >= argv.length) fail(`${arg} needs a value.`)
    options.set(arg, argv[i])
  } else {
    options.set(arg, true)
  }
}

const flag = (name, fallback = null) => options.get(name) ?? fallback
const present = (name) => options.has(name)

const redirectUri = positionals[0]
if (positionals.length > 1) {
  // One at a time, deliberately: two URIs in one command reads as "register both" and the
  // merge below would only ever see the first, which is a silent half-success.
  fail(
    `Two redirect URIs were given: ${positionals.join(' and ')}.`,
    'Run this once per URI. The second run adds to the first rather than replacing it.',
  )
}

if (!redirectUri || present('--help') || present('-h')) {
  console.log(`Create or update the Axiomate app registration in Entra ID.

  node scripts/entra-register.mjs <redirect-uri> [options]

  <redirect-uri>        Where Entra sends the browser back. Registered under the Web platform.
                        Both a localhost URI and a deployed one can be registered: run this
                        once for each, and the second run adds to the first rather than
                        replacing it.

  --name <name>         Display name of the registration. Default: Axiomate.
  --tenant <tenant>     The tenant this is meant to land in, checked against the signed-in
                        session before anything is created. Default: axiocloudsolutions.com.
  --new-secret          Mint a client secret and print it. Not the default: see the header.
  --secret-years <n>    How long that secret lives. Default: 1.
  --admin-consent       Grant tenant-wide consent for the three scopes, so no individual is
                        ever shown a consent prompt. Needs Cloud Application Administrator,
                        Application Administrator or Global Administrator.
`)
  // Asking for help succeeded; forgetting the argument did not. A script that exits zero on a
  // missing argument is a script that passes in a pipeline it should have stopped.
  process.exit(present('--help') || present('-h') ? 0 : 1)
}

const displayName = flag('--name', 'Axiomate')
const expectedTenant = flag('--tenant', 'axiocloudsolutions.com')
const wantSecret = present('--new-secret')
const secretYears = flag('--secret-years', '1')
const wantAdminConsent = present('--admin-consent')

// Refused here rather than by Graph, because the ceiling is a policy nobody remembers and the
// error it produces at the far end says nothing about two years being the limit.
if (!/^[12]$/.test(String(secretYears))) {
  fail(
    `--secret-years must be 1 or 2. Entra caps a client secret at twenty-four months,`,
    'and Microsoft recommends under twelve. Shorter and rotated beats longer and forgotten.',
  )
}

/* ---------------- The redirect URI is checked here, not by Entra ---------------- */

let parsed
try {
  parsed = new URL(redirectUri)
} catch {
  fail(`“${redirectUri}” is not an absolute URI. It must include the scheme.`)
}
const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
if (parsed.protocol !== 'https:' && !isLocal) {
  // Entra refuses this anyway, at registration time. Refusing here says why in one sentence
  // rather than as a Graph validation error about the value of a property.
  fail(`${redirectUri} is not https. Entra allows plain http only for localhost.`)
}
if (parsed.pathname !== CALLBACK_PATH) {
  // A warning rather than a refusal: a reverse proxy can legitimately mount the app under a
  // prefix. But a mismatch here produces AADSTS50011 at sign-in, which reads as a portal
  // problem and is really a typo, so it is worth saying out loud now.
  console.warn(
    `Note: the path is “${parsed.pathname}”, and this application serves its callback at “${CALLBACK_PATH}”.`,
  )
  console.warn('Unless a proxy mounts the app under a prefix, sign-in will fail with AADSTS50011.')
  console.warn('')
}

/* ================================================================== *
 * Running az
 * ================================================================== */

/**
 * Windows needs `shell: true` here and it is not optional.
 *
 * The Azure CLI on Windows is `az.cmd`, and since the argument-injection fix in Node 18.20 and
 * 20.12 a batch file cannot be spawned without a shell — it throws EINVAL rather than running.
 * Since this repository's own operator is on Windows, a script that only worked on POSIX would
 * be a script that never ran.
 */
const useShell = process.platform === 'win32'

/**
 * Once a shell is involved the quoting is ours to do.
 *
 * A display name contains spaces, a temporary path can, and `&` and `^` in either are operators
 * to cmd.exe rather than characters. Wrapping each argument in double quotes covers all of it.
 *
 * An argument that itself contains a double quote is refused rather than escaped. cmd.exe does
 * not honour a backslash escape, so any attempt to handle that case would be a quiet corruption
 * dressed up as support for it — and no legitimate value here needs one.
 */
function quote(arg) {
  const value = String(arg)
  if (!useShell) return value
  if (value.includes('"')) {
    fail(`Cannot pass “${value}” through the Windows shell: it contains a double quote.`)
  }
  return `"${value}"`
}

/**
 * Every call asks for JSON and every filter happens here in JavaScript.
 *
 * `--query` was the tidier option and was rejected: a JMESPath expression is full of characters
 * cmd.exe treats as operators, and the failure when one escapes is not an error but a wrong
 * answer. Parsing the whole object costs a larger buffer — hence `maxBuffer` — and nothing else.
 */
function az(args, { allowFailure = false } = {}) {
  const result = spawnSync('az', [...args, '--output', 'json'].map(quote), {
    shell: useShell,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })

  if (result.error?.code === 'ENOENT') {
    fail(
      'The Azure CLI is not installed, or `az` is not on the PATH.',
      'Install it from https://aka.ms/installazurecli, open a new terminal, and run this again.',
    )
  }
  if (result.status !== 0) {
    if (allowFailure) return { ok: false, stderr: (result.stderr ?? '').trim() }
    fail(`az ${args[0]} ${args[1] ?? ''} failed.`, (result.stderr ?? '').trim())
  }

  const out = (result.stdout ?? '').trim()
  return { ok: true, value: out ? JSON.parse(out) : null }
}

function fail(...lines) {
  console.error('')
  for (const line of lines) if (line) console.error(line)
  console.error('')
  process.exit(1)
}

/* ================================================================== *
 * Who is running this, and where
 * ================================================================== */

/**
 * Whether `az` exists is asked as its own question, because on Windows it cannot be inferred.
 *
 * With `shell: true` the missing-executable case never reaches Node as ENOENT: cmd.exe runs,
 * prints "'az' is not recognized", and exits 1 — indistinguishable, from here, from being
 * signed out. Without this probe the operator on the platform this repository is developed on
 * would be told to run `az login`, which cannot work and cannot be diagnosed from the message.
 */
const version = az(['version'], { allowFailure: true })
if (!version.ok) {
  fail(
    'The Azure CLI is not installed, or `az` is not on the PATH.',
    'Install it from https://aka.ms/installazurecli, open a new terminal, and run this again.',
    '',
    version.stderr,
  )
}

const account = az(['account', 'show'], { allowFailure: true })
if (!account.ok) {
  fail(
    'Nobody is signed in to the Azure CLI.',
    `Run this first:  az login --tenant ${expectedTenant}`,
    '',
    account.stderr,
  )
}

const tenantId = account.value.tenantId
const signedInAs = account.value.user?.name ?? 'unknown'

/**
 * Landing in the wrong tenant is the failure this prevents.
 *
 * It is confusing rather than loud: the registration is created successfully, in a directory
 * none of the firm's people exist in, and the first sign-in fails with an error about the user
 * account not being found. Comparing before creating anything turns that into one sentence.
 * `tenantDefaultDomain` is only present on recent CLI versions, so an inability to confirm is
 * reported as exactly that rather than treated as a mismatch.
 */
const wanted = expectedTenant.toLowerCase()
const names = [account.value.tenantDefaultDomain, account.value.tenantDisplayName]
  .filter(Boolean)
  .map((s) => String(s).toLowerCase())

/**
 * Compared on the first label as well as in full, because the two names for a tenant differ.
 *
 * `tenantDefaultDomain` is the initial `<something>.onmicrosoft.com` domain, and a firm signs in
 * with its verified custom domain — so a strict comparison would refuse
 * `axiocloudsolutions.com` against `axiocloudsolutions.onmicrosoft.com`, which is the same
 * directory. A false refusal here is worse than a missed one: it stops the operator with no
 * obvious way forward, and the point of the check is to catch a genuinely different tenant.
 */
const firstLabel = (s) => s.split('.')[0]
const confirmed =
  wanted === String(tenantId).toLowerCase() ||
  names.some((n) => n === wanted || firstLabel(n) === firstLabel(wanted))

if (names.length && !confirmed) {
  fail(
    `The signed-in session is in ${names.join(' / ')} (${tenantId}),`,
    `and this was asked to register in ${expectedTenant}. Nothing has been created.`,
    '',
    `Switch with:  az login --tenant ${expectedTenant}`,
    'Or pass --tenant to say the current directory is the intended one.',
  )
}
if (!names.length && !confirmed) {
  console.warn(`This CLI version does not report a tenant name, so ${expectedTenant} could not be`)
  console.warn('confirmed. Check the tenant id below against the portal before deploying.')
  console.warn('')
}

console.log(`Signed in as ${signedInAs}`)
console.log(`Tenant id    ${tenantId}`)
console.log('')

/* ================================================================== *
 * The three permissions
 * ================================================================== */

const graphSp = az(['ad', 'sp', 'show', '--id', GRAPH_APP_ID])
const graphScopes = graphSp.value?.oauth2PermissionScopes ?? []

const resourceAccess = SCOPES.map((value) => {
  const scope = graphScopes.find((s) => s.value === value)
  if (!scope) {
    fail(
      `Microsoft Graph in this tenant does not publish a delegated scope called “${value}”.`,
      'That should be impossible, and means the Graph service principal was read incorrectly.',
    )
  }
  return { id: scope.id, type: 'Scope' }
})

console.log('Delegated Microsoft Graph permissions, resolved from this tenant:')
for (const [i, value] of SCOPES.entries()) console.log(`  ${value.padEnd(8)} ${resourceAccess[i].id}`)
console.log('')

/**
 * Passed through a file rather than as inline JSON.
 *
 * `--required-resource-accesses` accepts either, and inline JSON is a string of braces and
 * quotes crossing a shell that rewrites both. A temporary file crosses as a path.
 *
 * The `@path` form is what Microsoft's own examples for `az ad app create` and `az ad app
 * update` use, while the parameter's help text describes a bare path. Both are tried rather than
 * one being guessed at: this is the only argument on the only code path that must work, it could
 * not be exercised where this was written, and a wrong guess fails with a JSON parse error that
 * points at the manifest rather than at the calling convention.
 */
const manifestPath = path.join(os.tmpdir(), `axiomate-entra-${process.pid}.json`)
fs.writeFileSync(
  manifestPath,
  JSON.stringify([{ resourceAppId: GRAPH_APP_ID, resourceAccess }], null, 2),
)

function withManifest(args) {
  const first = az([...args, '--required-resource-accesses', `@${manifestPath}`], { allowFailure: true })
  if (first.ok) return first
  const second = az([...args, '--required-resource-accesses', manifestPath], { allowFailure: true })
  if (second.ok) return second
  fail(`az ${args[0]} ${args[1]} ${args[2]} failed.`, first.stderr, '', second.stderr)
}

/* ================================================================== *
 * Create, or update in place
 * ================================================================== */

let app
try {
  // Filtered here rather than trusted to the server-side filter, which has matched on a prefix
  // in some CLI versions — and "Axiomate" is a prefix of "Axiomate (old)".
  const found = (az(['ad', 'app', 'list', '--display-name', displayName]).value ?? []).filter(
    (a) => a.displayName === displayName,
  )
  if (found.length > 1) {
    fail(
      `There are ${found.length} registrations named “${displayName}” in this tenant:`,
      found.map((a) => `  ${a.appId}`).join('\n'),
      'This script cannot tell which one is meant. Rename or delete the ones that are not.',
    )
  }

  const existing = found[0]

  /**
   * Common to both paths.
   *
   * `--sign-in-audience AzureADMyOrg` because this is one firm's delivery tool and a
   * multi-tenant registration would let any Entra directory in the world start a sign-in
   * against it. The two implicit-flow switches are off because the application uses the
   * authorisation-code flow: the id token is redeemed from the token endpoint, server to
   * server, and `enableIdTokenIssuance` would additionally allow one to be returned straight to
   * the browser on the redirect — a capability nothing here needs and an attack surface
   * somebody would otherwise have to reason about.
   */
  const shared = [
    '--sign-in-audience', 'AzureADMyOrg',
    '--enable-id-token-issuance', 'false',
    '--enable-access-token-issuance', 'false',
  ]

  if (!existing) {
    console.log(`Creating the registration “${displayName}”…`)
    app = withManifest(['ad', 'app', 'create', '--display-name', displayName, '--web-redirect-uris', redirectUri, ...shared]).value
    // Checked because nothing below re-reads the registration on this path, and an appId that
    // arrived as undefined would surface three calls later as an unrelated-looking failure.
    if (!app?.appId) fail('Entra reported the registration was created but returned no appId.')
    console.log('Created.')
  } else {
    /**
     * The union, and the reason this script exists rather than a one-line az command.
     *
     * `--web-redirect-uris` sets the list; it does not add to it. Passing only the new URI on a
     * second run would delete the first, which is how a deployment loses its production
     * redirect the day somebody sets up a local environment.
     */
    const current = existing.web?.redirectUris ?? []
    const merged = [...new Set([...current, redirectUri])]
    const added = merged.length > current.length

    console.log(`Updating the existing registration ${existing.appId}…`)
    if (added) console.log(`  adding redirect URI ${redirectUri}`)
    else console.log(`  redirect URI ${redirectUri} was already registered`)

    withManifest(['ad', 'app', 'update', '--id', existing.appId, '--web-redirect-uris', ...merged, ...shared])
    app = az(['ad', 'app', 'show', '--id', existing.appId]).value
    console.log('Updated.')
  }
} finally {
  // The file holds no secret, only three public GUIDs. Removed because a temp file nobody
  // deletes is a temp file that is still there in a year confusing somebody.
  fs.rmSync(manifestPath, { force: true })
}

const clientId = app.appId
console.log('')

/* ================================================================== *
 * The service principal
 * ================================================================== */

/**
 * Created explicitly rather than left to appear on first consent.
 *
 * Entra creates one automatically the first time somebody signs in, so this is not strictly
 * required. It is done anyway because until it exists the application is invisible under
 * Enterprise applications, which is where an administrator grants tenant-wide consent, reviews
 * what was consented to, and restricts who may sign in. An administrator who cannot find the
 * application concludes the registration did not work.
 */
const sp = az(['ad', 'sp', 'show', '--id', clientId], { allowFailure: true })
if (!sp.ok) {
  console.log('Creating the service principal (the Enterprise application entry)…')
  az(['ad', 'sp', 'create', '--id', clientId])
  console.log('Created.')
} else {
  console.log('Service principal already present.')
}

if (wantAdminConsent) {
  console.log('Granting tenant-wide admin consent…')
  const consent = az(['ad', 'app', 'permission', 'admin-consent', '--id', clientId], { allowFailure: true })
  if (!consent.ok) {
    /*
     * Not fatal, and usually not final either.
     *
     * When the service principal was created moments ago the directory has often not finished
     * replicating it, and consent fails on an object that demonstrably exists. Saying so matters:
     * without it the operator reads one failure as "this tenant does not permit admin consent"
     * and stops, when running the same command again in a minute succeeds.
     */
    console.warn('Admin consent failed. The registration itself is correct, and each person can')
    console.warn('still consent for themselves. If the service principal was created just now,')
    console.warn('the directory may not have replicated it yet — wait a minute and run again with')
    console.warn('--admin-consent. Doing so is safe; nothing else in this script repeats.')
    console.warn('')
    console.warn(consent.stderr)
  } else {
    console.log('Granted. Nobody will be shown a consent prompt.')
  }
}
console.log('')

/* ================================================================== *
 * The secret
 * ================================================================== */

let secret = null
if (wantSecret) {
  /**
   * `--append` is load-bearing.
   *
   * Without it, `credential reset` does what its name says and clears every existing password
   * on the registration. On a live deployment that is an outage: the running instance is still
   * holding a secret that stopped being valid halfway through this script, and the failure
   * appears as sign-in breaking for everyone with no deployment having taken place.
   */
  const created = az([
    'ad', 'app', 'credential', 'reset',
    '--id', clientId,
    '--append',
    '--display-name', `axiomate-${new Date().toISOString().slice(0, 10)}`,
    '--years', String(secretYears),
  ])
  secret = created.value?.password ?? null
  if (!secret) fail('Entra created a credential but returned no password. Nothing to print.')
}

/* ---------------- What is already there, and when it dies ---------------- */

const credentials = az(['ad', 'app', 'show', '--id', clientId]).value?.passwordCredentials ?? []
if (credentials.length) {
  console.log('Client secrets on this registration:')
  for (const c of credentials) {
    const ends = new Date(c.endDateTime)
    const days = Math.round((ends.getTime() - Date.now()) / 86_400_000)
    const name = c.displayName ?? '(unnamed)'
    console.log(`  ${c.keyId}  ${name.padEnd(24)} expires ${c.endDateTime.slice(0, 10)} (${days} days)`)
  }
  if (credentials.length > 1) {
    console.log('')
    console.log('More than one is live. After the new one is deployed and sign-in is confirmed,')
    console.log('delete the old one so an expiry cannot be mistaken for a working credential:')
    console.log(`  az ad app credential delete --id ${clientId} --key-id <key id>`)
  }
  console.log('')
}

/* ================================================================== *
 * The output
 * ================================================================== */

/**
 * Printed to stdout and written nowhere.
 *
 * Writing these into `.env` would be the convenient thing and it is refused for three reasons,
 * in increasing order of how much they matter. First, this script cannot know which environment
 * the operator is configuring — the deployed host's secret does not belong in a developer's
 * working copy, and the machine running `az` is usually not the machine running Axiomate.
 * Second, `.env` is a file a person edits and a script that rewrites it eventually destroys a
 * value somebody typed; `scripts/db-setup.mjs` refuses to overwrite an existing `.env` for the
 * same reason. Third and most importantly, a secret that is written to disk is a secret that
 * has been written to disk: it survives in the file, in the editor's undo history and in any
 * backup that ran afterwards. Printed, it exists in one terminal, and the operator decides
 * where it lands — which for anything but a laptop should be a secret store, not a file.
 */
console.log('---------------------------------------------------------------------------')
console.log('Set these where the application runs. Do not commit them.')
console.log('')
console.log(`AXIOMATE_ENTRA_TENANT_ID=${tenantId}`)
console.log(`AXIOMATE_ENTRA_CLIENT_ID=${clientId}`)
if (secret) {
  console.log(`AXIOMATE_ENTRA_CLIENT_SECRET=${secret}`)
} else {
  console.log('AXIOMATE_ENTRA_CLIENT_SECRET=          # run again with --new-secret to mint one')
}
console.log(`AXIOMATE_ENTRA_REDIRECT_URI=${redirectUri}`)
console.log('---------------------------------------------------------------------------')
console.log('')

if (secret) {
  console.log('That secret is shown once. Entra cannot display it again, and neither can this.')
  console.log('')
}

/**
 * The fifth value, which is not an Entra value and is why sign-in fails when all four are set.
 *
 * `lib/auth/cookie.ts` refuses to sign a session without `AXIOMATE_SESSION_SECRET`, so a
 * deployment with a perfect registration and no signing key completes the round trip to Entra
 * and then lands back on the application with an auth error about a missing secret. Naming it
 * here costs two lines and saves an afternoon.
 */
console.log('Sign-in also needs AXIOMATE_SESSION_SECRET — at least 32 characters, different in')
console.log('every environment. Without it the callback fails after Entra has already succeeded:')
console.log('  openssl rand -base64 48')
console.log('')
console.log('Check these against the portal before deploying:')
console.log(`  https://entra.microsoft.com  →  App registrations  →  ${displayName}`)
console.log('')
console.log('Then read docs/entra.md before the first person signs in. Nobody holds a role on a')
console.log('fresh deployment, and what happens instead is not what anyone expects.')
