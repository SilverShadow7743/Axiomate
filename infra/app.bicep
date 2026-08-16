/*
  Axiomate — App Service plan and Linux Web App.

  Consumed by a top-level template. This module owns the compute and the application's
  environment; it owns no secret store, no database and no role assignment. It emits
  `principalId` so the template that does own the vault can grant this app read access.

  ---------------------------------------------------------------------------------------------
  1. How this application actually starts

  Axiomate is not a static site and cannot be served as one. `app/page.tsx` is a server
  component marked `dynamic = 'force-dynamic'`, and every route handler under `app/api/`
  declares `runtime = 'nodejs'` — they read `process.env`, open a Postgres
  connection through `@prisma/adapter-pg`, and sign cookies with `node:crypto`. There is a
  Node process behind every request; there is nothing to put on a CDN.

  `next.config.ts` sets only `reactStrictMode`. It does **not** set `output: 'standalone'`,
  and this module deliberately does not ask for it to be — that file belongs to the
  application. What follows from its absence is the whole deployment contract:

    - `next build` writes `.next/` plus `.next/*.nft.json` file traces. It does *not* write
      `.next/standalone/server.js`. There is no self-contained server to launch.
    - Therefore the startup command is `npm run start`, which runs `next start`, and that
      command requires the full production `node_modules` tree to be present on the instance
      beside `.next/`. Pointing `appCommandLine` at `node .next/standalone/server.js` — the
      usual App Service recipe for Next — would fail on every boot with MODULE_NOT_FOUND.
    - `next start` binds to `process.env.PORT`, which the App Service Linux Node image sets.
      Nothing here needs to pin a port, and `WEBSITES_PORT` is deliberately absent: it applies
      to custom containers, and setting it against a blessed image is a red herring that
      survives in configuration long after whoever added it has left.

  ---------------------------------------------------------------------------------------------
  2. Scale-out and the scheduled pass

  The pass has no timer of its own: `POST /api/schedule/run` is the only thing that starts it,
  by design, because a `setInterval` inside a web server runs twice on two instances. Two
  triggers arriving at two instances is therefore the case that has to be safe, and it is —
  but for a specific reason, not because HTTP triggers are inherently safe.

  What was checked, in `lib/db/schedule.ts`: the entire pass — reading the workspace, deciding
  what has become true, writing the notifications, and writing its own memory of what it
  raised — happens inside one `prisma.$transaction` at `isolationLevel: 'Serializable'`. The
  memory is a row in `scheduleWatch` keyed by tenant, upserted in that same transaction. So the
  second concurrent run blocks, then reads the first run's observation, and finds nothing newly
  overdue. Nothing is raised twice.

  What would make it unsafe, precisely:
    - dropping that isolation level to the Prisma default, which would let both runs read the
      same pre-run observation;
    - moving the `scheduleWatch` upsert outside the transaction, which would let a crash record
      messages without recording that they were sent, or the reverse;
    - reintroducing an in-process timer, which is what the endpoint exists to avoid.

  There is one genuine multi-instance hazard, and it is not the pass. `lib/db/boot.ts` calls
  `importWorkspace` on every page render, and that function's `seededAt` guard is read *before*
  the transaction that sets it. Two instances rendering the page concurrently against an empty
  database both see "not yet seeded" and both attempt the import; the composite primary key
  `(tenantId, id)` makes the loser fail rather than duplicate, so the data stays correct, but
  that user's page falls back to the read-only seed file with a database error. It is a
  first-boot-only race and it self-heals on reload — which is why `instanceCount` defaults to 1
  and why scaling out is a decision rather than a default.

  Sessions do not constrain scale-out. `lib/auth/seal.ts` signs the session cookie with an HMAC
  over `AXIOMATE_SESSION_SECRET`, and `lib/auth/entra.ts` keeps the OAuth state, nonce and PKCE
  verifier in cookies rather than server memory. Every instance can therefore verify every
  request, which is why `clientAffinityEnabled` is switched off below.

  ---------------------------------------------------------------------------------------------
  3. Restarts and the autosave queue

  The browser queues writes and drains them one request at a time (`components/useAutosave.ts`).
  A 5xx or a dropped connection is retried with backoff of 0.5s, 1s, 2s, 4s and then gives up:
  a budget of roughly 7.5 seconds. 409 and 401 are terminal by design, so only genuinely
  transient failures consume it.

  That budget is shorter than an App Service instance restart. Two settings here bear on it:

    - `alwaysOn`. Without it the app is unloaded after ~20 minutes idle, so the first request of
      the morning pays a cold start that exceeds the retry budget outright.
    - the SKU. Basic has no deployment slots, so every deploy is a hard restart of the only
      instance and every editor with work in flight sees "Not saved". A slot swap on Premium v3
      warms the new instance first. This is the honest cost of the default below, and it is
      user-visible rather than cosmetic.
*/

targetScope = 'resourceGroup'

/* ============================================================================================ *
 * Naming and placement
 * ============================================================================================ */

@description('Host name of the Web App. Changing it changes the public URL, which invalidates the Entra redirect URI registered against it and signs everybody out until both are updated together.')
@minLength(2)
@maxLength(60)
param appName string

@description('Name of the App Service plan. Changing it on an existing deployment creates a second plan and bills for both until the old one is removed by hand.')
@minLength(1)
@maxLength(40)
param planName string

@description('Region for both plan and app. Changing it after deployment is a rebuild, not a move, and adds cross-region latency to every database query unless Postgres moves with it.')
param location string = resourceGroup().location

@description('Tags applied to both resources. Changing them costs nothing and is the only handle cost reporting has on this workload.')
param tags object = {}

/* ============================================================================================ *
 * Plan
 * ============================================================================================ */

/*
  Why B1 is the default.

  It is the cheapest tier that supports Always On, a custom domain and a free managed
  certificate — the three things this application actually needs — at roughly the price of a
  single user licence for the tools it replaces. F1 is offered below only so an evaluation
  deployment is possible; it has no Always On, a 60 CPU-minute daily quota and 1 GB of storage,
  and it will not run this app for a working day. It is not a cheaper B1.

  What B1 does not buy, and what the upgrade is for: no deployment slots, so every deploy is a
  restart (see note 3 above); no autoscale, only manual capacity up to 3. P0v3 is the answer to
  both and is the recommended step up — S1 costs more than P0v3 for slower cores and less
  memory, which is why it is not the one named here even though it is the traditional choice.

  Indicative pay-as-you-go list prices, Linux, UK South, per instance per month. These are
  estimates from published rates and are not verifiable without a subscription:
    F1     nil
    B1     £11–15
    B2     £22–30
    B3     £45–60
    P0v3   £45–60
    P1v3   £90–115
*/
@description('Plan size. Moving up buys memory, CPU and — from Premium v3 — deployment slots, which is what stops a deploy from showing every editor "Not saved". Moving down to F1 removes Always On and caps daily CPU, which breaks the scheduled pass.')
@allowed([
  'F1'
  'B1'
  'B2'
  'B3'
  'S1'
  'S2'
  'P0v3'
  'P1v3'
  'P2v3'
])
param skuName string = 'B1'

@description('Instances to run. Above 1 the first render against an empty database can race itself during initial seeding (see note 2), and each instance opens its own Postgres pool, so raising this without raising the database connection limit trades one bottleneck for another.')
@minValue(1)
@maxValue(10)
param instanceCount int = 1

// The tier is stated rather than left to ARM to infer from the SKU name. Inference works for
// the older names and is unreliable for the v3 family, and the failure is a plan created in the
// wrong tier rather than a rejected deployment.
var skuTiers = {
  F1: 'Free'
  B1: 'Basic'
  B2: 'Basic'
  B3: 'Basic'
  S1: 'Standard'
  S2: 'Standard'
  P0v3: 'PremiumV3'
  P1v3: 'PremiumV3'
  P2v3: 'PremiumV3'
}

var skuTier = skuTiers[skuName]

// Shared-compute tiers reject `alwaysOn` outright rather than ignoring it, so this is a
// deployment failure and not a silent downgrade. Expressed as a condition so the SKU parameter
// stays genuinely free rather than being a parameter with one usable value.
var alwaysOnAvailable = !contains(['F1', 'D1'], skuName)

/* ============================================================================================ *
 * Runtime
 * ============================================================================================ */

/*
  Node 22 LTS, checked rather than assumed. `node_modules/next/package.json` in this repo is
  16.3.1 and declares `engines: { node: '>=20.9.0' }`; `package.json` names no `engines` of its
  own, so the framework's floor is the only constraint that exists. 22 clears it, is the LTS
  line with the longest remaining support, and — unlike 24 — is what the toolchain here
  (`@types/node` ^26, Prisma 7, Tailwind 4) has been exercised against.

  `WEBSITE_NODE_DEFAULT_VERSION` is deliberately absent: it is the Windows mechanism, and on
  Linux the version comes from `linuxFxVersion` alone. Setting both is how a plan ends up
  running a version nobody chose.
*/
@description('Linux runtime stack. Below NODE|20-lts the framework refuses to start (Next 16 requires Node >= 20.9); moving up a major line is an untested runtime change, not a patch.')
param nodeVersion string = 'NODE|22-lts'

/*
  Health check.

  `/api/health` is the path, and it is a dependency on the application rather than something
  this module can provide: App Service removes an instance from rotation when the path answers
  non-2xx, so pointing it at a route that does not exist takes instances out of service on the
  strength of a 404. The endpoint has to be anonymous — App Service cannot present a
  credential — and it must not fail merely because `DATABASE_URL` is unset, since running from
  the seed file is a supported mode and evicting instances for behaving as designed is worse
  than not checking at all.

  The default here is empty, which switches the feature off, because a module consumed by
  another template cannot know whether the build being deployed contains that route. The
  Axiocloud parameter file turns it on; a consumer deploying a different build does not inherit
  a check it may not satisfy.
*/
@description('Path App Service polls to decide an instance is healthy. Empty disables the check. Pointing it at a route the deployed build does not serve, or one that fails whenever the database blips, evicts instances that are working.')
param healthCheckPath string = ''

/* ============================================================================================ *
 * Application settings
 *
 * Every value below is a parameter, and every one may be empty. That is a property of this
 * application rather than a convenience: `lib/auth/entra.ts`, `lib/auth/cookie.ts`,
 * `lib/identity.ts`, `lib/tenant.ts`, `app/api/intake/route.ts` and `app/api/schedule/run/route.ts`
 * each read their variable as `process.env.X?.trim()` and branch on it being falsy, so an empty
 * setting and an absent one are the same fact. Omitting the setting entirely was the
 * alternative and was rejected: it makes the deployed configuration surface invisible, and a
 * variable you cannot see in the portal is one nobody remembers to fill in.
 *
 * Secrets are `@secure()` and may carry either a literal or a Key Vault reference string of the
 * form `@Microsoft.KeyVault(SecretUri=...)`. This module does not care which, and deliberately
 * has no opinion about the vault: resolving a reference needs a role assignment that the
 * top-level template makes from the `principalId` output below.
 * ============================================================================================ */

@description('Postgres connection string. Empty is a supported mode — the workspace falls back to browser storage and nothing is shared between users — so leaving it unset degrades the product rather than breaking it. Pool size is set here, in the query string, and is what a scale-out has to respect.')
@secure()
param databaseUrl string = ''

@description('Which delivery firm this deployment serves. Changing it on a live deployment points the app at a different tenant partition and at a different browser storage namespace, so the existing workspace disappears from view without being deleted.')
param tenantSlug string = 'axiocloud'

@description('Name written into the audit trail when no identity provider is configured. Leaving it empty attributes the entire trail to a default operator, which is worse than an unattributed one.')
param operatorName string = ''

@description('HMAC key for the session cookie. Empty means no sessions at all, deliberately, so sign-in cannot work without it. Changing it signs everybody out; sharing it between environments makes one environment cookie valid in the other.')
@secure()
param sessionSecret string = ''

@description('Bearer token the scheduled pass accepts. Empty leaves the endpoint reachable only by a signed-in administrator, which is enough to run the pass by hand and not enough to run it on a schedule.')
@secure()
param scheduleToken string = ''

@description('Bearer token the intake endpoint requires. Empty closes intake completely, which is the correct default for an endpoint that creates records from outside the firm.')
@secure()
param intakeToken string = ''

@description('Entra directory (tenant) id. This and the next three are all-or-nothing: with any one empty the app runs as the single configured operator and shows no sign-in it cannot satisfy.')
param entraTenantId string = ''

@description('Entra application (client) id. Empty, with the other three, means sign-in is off and every request is trusted as the configured operator.')
param entraClientId string = ''

@description('Entra client secret. Expiring it without replacing it breaks sign-in for everyone while the app still appears configured, which is the failure that looks like an outage.')
@secure()
param entraClientSecret string = ''

@description('Redirect URI registered against the Entra app. It must match the registration exactly; a mismatch fails the callback rather than the sign-in, so the error surfaces after the user has already authenticated. Taken as a parameter rather than derived from the host name to avoid a self-reference in this resource — the expected value is emitted as an output.')
param entraRedirectUri string = ''

@description('Anthropic API key. Empty leaves the assistant answering from the workspace index alone and unable to draft changes; it does not disable the feature or hide it.')
@secure()
param anthropicApiKey string = ''

@description('Application Insights connection string. Empty omits the setting and the agent extension together, so no telemetry is collected and none is attempted — a half-configured agent retries and logs on every request.')
@secure()
param appInsightsConnectionString string = ''

/*
  Where the build happens.

  Default false: the artifact is built in CI and deployed complete. Because there is no
  standalone output (note 1), that artifact must carry `node_modules`, `.next`, `public`,
  `package.json` and `prisma/` — it is large, and that is the cost of this choice.

  The rejected alternative is Oryx building on the instance (`SCM_DO_BUILD_DURING_DEPLOYMENT`
  true). A Next 16 production build on B1's single core and 1.75 GB is a real out-of-memory
  risk, and it would run on the instance that is also serving requests.

  `WEBSITE_RUN_FROM_PACKAGE` is not set here on purpose. It mounts wwwroot read-only and is
  mutually exclusive with an Oryx build, so setting it from infrastructure would silently make
  this parameter inert. It belongs to whatever ships the bits.
*/
@description('Whether App Service builds the app on the instance after deployment. True moves a Next production build onto the web tier, where on Basic it is likely to exhaust memory; false requires the pipeline to deploy a fully built artifact including node_modules.')
param buildOnDeploy bool = false

/* ============================================================================================ *
 * Resources
 * ============================================================================================ */

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: planName
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuTier
    // F1 is single-instance by definition; asking for more is a deployment error rather than a
    // capped request.
    capacity: skuName == 'F1' ? 1 : instanceCount
  }
  kind: 'linux'
  properties: {
    // The single most consequential line in this file. Without `reserved: true` ARM creates a
    // Windows plan, `linuxFxVersion` is accepted and then ignored, and the app boots into a
    // stack nobody asked for.
    reserved: true
  }
}

resource webApp 'Microsoft.Web/sites@2024-04-01' = {
  name: appName
  location: location
  tags: tags
  kind: 'app,linux'
  identity: {
    // System-assigned rather than user-assigned: this identity has exactly one consumer and
    // should not outlive it. A user-assigned identity left behind after the app is deleted is
    // a standing grant on the vault with nothing attached to it.
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    // Sessions are stateless — an HMAC-signed cookie any instance can verify, with the OAuth
    // state and PKCE verifier also in cookies — so affinity buys nothing and costs something:
    // it pins each editor to one instance, so that instance restarting takes their autosave
    // queue with it instead of spreading the cost.
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: nodeVersion
      alwaysOn: alwaysOnAvailable
      // Explicit rather than left to Oryx's guess. Oryx usually infers `npm start` for a Next
      // app, but "usually" is not a deployment contract, and the failure mode is a container
      // that starts and serves nothing.
      appCommandLine: 'npm run start'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      // Empty rather than a conditional `null`. Empty string is how App Service expresses "no
      // health check", and it types cleanly; the ternary-to-null form depends on the property
      // being declared optional in whichever Bicep type set is installed, which is a
      // compile-time gamble taken for no behavioural gain.
      healthCheckPath: healthCheckPath
      appSettings: concat(baseSettings, telemetrySettings)
    }
  }
}

/*
  NODE_ENV is deliberately not set.

  `next start` sets it to production for the server itself, so setting it here gains nothing —
  and it actively breaks an on-instance build, because `npm install` under NODE_ENV=production
  skips devDependencies and this app's build needs typescript, tailwindcss and postcss from
  exactly there.
*/
var baseSettings = [
  {
    name: 'DATABASE_URL'
    value: databaseUrl
  }
  {
    name: 'AXIOMATE_TENANT'
    value: tenantSlug
  }
  {
    name: 'AXIOMATE_OPERATOR'
    value: operatorName
  }
  {
    name: 'AXIOMATE_SESSION_SECRET'
    value: sessionSecret
  }
  {
    name: 'AXIOMATE_SCHEDULE_TOKEN'
    value: scheduleToken
  }
  {
    name: 'AXIOMATE_INTAKE_TOKEN'
    value: intakeToken
  }
  {
    name: 'AXIOMATE_ENTRA_TENANT_ID'
    value: entraTenantId
  }
  {
    name: 'AXIOMATE_ENTRA_CLIENT_ID'
    value: entraClientId
  }
  {
    name: 'AXIOMATE_ENTRA_CLIENT_SECRET'
    value: entraClientSecret
  }
  {
    name: 'AXIOMATE_ENTRA_REDIRECT_URI'
    value: entraRedirectUri
  }
  {
    name: 'ANTHROPIC_API_KEY'
    value: anthropicApiKey
  }
  {
    // Spelled out rather than converted with `string()`: ARM renders a boolean as `True`, and
    // an app setting is a string that Kudu parses, so the conversion that reads as tidier is
    // the one that produces a value nothing matches on.
    name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
    value: buildOnDeploy ? 'true' : 'false'
  }
]

// The agent extension and the connection string travel together. Setting the extension version
// without a connection string loads an agent that fails on every request and reports nothing;
// omitting both is the only honest way to express "no telemetry".
var telemetrySettings = empty(appInsightsConnectionString)
  ? []
  : [
      {
        name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
        value: appInsightsConnectionString
      }
      {
        name: 'ApplicationInsightsAgent_EXTENSION_VERSION'
        value: '~3'
      }
      {
        name: 'XDT_MicrosoftApplicationInsights_Mode'
        value: 'recommended'
      }
    ]

/* ============================================================================================ *
 * Outputs
 *
 * No secret is echoed here. Template outputs are readable from the deployment history for
 * anyone with reader on the resource group, which makes an output the least private place in
 * the subscription to put a connection string.
 * ============================================================================================ */

@description('Object id of the system-assigned identity. This is what a Key Vault role assignment is made against; the secrets above stay unresolved until that assignment exists and the app has restarted.')
output principalId string = webApp.identity.principalId

// Named for the identity rather than called `tenantId`, because in this codebase a tenant is
// the delivery firm — `AXIOMATE_TENANT` — and an output that answers a different question under
// that name is the kind of thing a consumer wires up once and never re-reads.
@description('Entra directory the managed identity belongs to, for a role assignment made from another directory.')
output identityTenantId string = webApp.identity.tenantId

@description('Resource id of the Web App, for role assignments, diagnostics and slot operations.')
output appResourceId string = webApp.id

// `webAppName`, not `appName`: params, vars, resources and outputs share one symbol table in
// Bicep, so reusing the parameter's name here is a compile error rather than a shadow.
@description('Name of the Web App, for the deployment pipeline to target.')
output webAppName string = webApp.name

@description('Resource id of the plan, so a second app can share it rather than paying for a second one.')
output planResourceId string = plan.id

@description('Default host name.')
output defaultHostName string = webApp.properties.defaultHostName

@description('Base URL of the running application.')
output appUrl string = 'https://${webApp.properties.defaultHostName}'

@description('The redirect URI this deployment expects, on the default host name. Register this in Entra and pass it back as entraRedirectUri; it is emitted rather than used because reading the host name inside the app settings that configure the app would be a self-reference.')
output expectedEntraRedirectUri string = 'https://${webApp.properties.defaultHostName}/api/auth/callback'

@description('The scheduled-pass trigger URL, for whatever cron, Task Scheduler job, GitHub Action or Azure timer is pointed at it.')
output scheduleTriggerUrl string = 'https://${webApp.properties.defaultHostName}/api/schedule/run'

@description('Whether Always On was applied. False means the chosen SKU cannot support it and the first request after an idle period pays a cold start the browser autosave queue may not survive.')
output alwaysOnEnabled bool = alwaysOnAvailable
