/*
  Axiomate — parameters for a standalone deployment of the compute module.

    az deployment group create -g <rg> -f infra/app.bicep -p infra/app.bicepparam

  When `infra/main.bicep` composes the estate it passes its own values instead — the database
  URL from the Postgres module, the secrets as Key Vault references — and this file is not read.
  It exists so the module can be deployed and corrected on its own, which is the only way to
  find out whether it starts.

  ---------------------------------------------------------------------------------------------
  No secret is written here.

  Every secret below is read from the environment at build time and defaults to empty, which
  this application treats as "not configured" rather than as an error. That is what makes the
  pattern safe: a forgotten variable produces a deployment with the assistant offline and
  intake closed, not one with a placeholder secret that works.

  Supply them for a real deployment either by exporting the variable:

    export AXIOMATE_SESSION_SECRET="$(openssl rand -base64 48)"

  or, once `infra/keyvault.bicep` exists and the role assignment has been made from this
  module's `principalId` output, by passing a reference string in the same variable:

    export DATABASE_URL='@Microsoft.KeyVault(SecretUri=https://<vault>.vault.azure.net/secrets/database-url/)'

  The module does not distinguish the two. The reference resolves to nothing until the role
  assignment exists and the app has restarted, so on a first deployment the app comes up
  without a database and recovers on the restart that follows the grant.
*/

using './app.bicep'

/* -------------------------------------------------------------------------------------------- *
 * Naming
 *
 * `axiomate-axiocloud` rather than a random suffix: the host name ends up in the Entra
 * registration, in whatever triggers the scheduled pass, and in people's bookmarks, so it is a
 * name that has to be typed and remembered rather than generated. It must be globally unique —
 * if it is taken, change it here before deploying rather than after.
 * -------------------------------------------------------------------------------------------- */

param appName = 'axiomate-axiocloud'
param planName = 'asp-axiomate-axiocloud'

// UK South: the firm and its clients are UK-based, and the database should be in the same
// region — every page render is several round trips through Prisma, so a cross-region plan
// costs latency on every request rather than only on writes.
param location = 'uksouth'

param tags = {
  application: 'axiomate'
  tenant: 'axiocloud'
  component: 'web'
  managedBy: 'bicep'
}

/* -------------------------------------------------------------------------------------------- *
 * Size
 * -------------------------------------------------------------------------------------------- */

// B1 for a firm of this size. See the note in app.bicep for what it does not buy — chiefly
// deployment slots, which is why every deploy interrupts anyone mid-edit. Move to P0v3 when
// that interruption starts being noticed, not before.
param skuName = 'B1'

// One instance. Not a capacity judgement: the first render against an empty database races
// itself across instances during initial seeding, so the second instance is added after the
// workspace has been seeded once, not before.
param instanceCount = 1

/* -------------------------------------------------------------------------------------------- *
 * Runtime
 * -------------------------------------------------------------------------------------------- */

param nodeVersion = 'NODE|22-lts'

// On, because this build serves it: `app/api/health/route.ts` answers anonymously, probes the
// database with a cached `SELECT 1`, and treats an unset DATABASE_URL as healthy rather than as
// a fault — which are the three properties that make a health check safe to switch on. Turn it
// back off if that route is ever removed; a 404 here evicts working instances.
param healthCheckPath = '/api/health'

// The artifact is built in CI. Without `output: 'standalone'` that artifact has to carry
// node_modules; building here instead would put a Next production build on a single 1.75 GB
// core that is also serving requests.
param buildOnDeploy = false

/* -------------------------------------------------------------------------------------------- *
 * Configuration
 * -------------------------------------------------------------------------------------------- */

param tenantSlug = 'axiocloud'

// Set this. Left empty, every entry in the audit trail is attributed to a default operator —
// a person who has never touched the deployment — which is worse than an unattributed trail.
param operatorName = readEnvironmentVariable('AXIOMATE_OPERATOR', '')

param databaseUrl = readEnvironmentVariable('DATABASE_URL', '')

param sessionSecret = readEnvironmentVariable('AXIOMATE_SESSION_SECRET', '')
param scheduleToken = readEnvironmentVariable('AXIOMATE_SCHEDULE_TOKEN', '')
param intakeToken = readEnvironmentVariable('AXIOMATE_INTAKE_TOKEN', '')

/* -------------------------------------------------------------------------------------------- *
 * Identity
 *
 * All four or none. With any one missing the application runs as the single operator above and
 * shows no sign-in screen, which is deliberate — a deployment without credentials should work.
 *
 * The redirect URI is a parameter rather than something the module derives, because deriving it
 * from the host name inside the settings that configure the app would be a self-reference.
 * `az deployment group show ... --query properties.outputs.expectedEntraRedirectUri` prints the
 * value to register; it is spelled out here so the two cannot drift silently.
 * -------------------------------------------------------------------------------------------- */

param entraTenantId = readEnvironmentVariable('AXIOMATE_ENTRA_TENANT_ID', '')
param entraClientId = readEnvironmentVariable('AXIOMATE_ENTRA_CLIENT_ID', '')
param entraClientSecret = readEnvironmentVariable('AXIOMATE_ENTRA_CLIENT_SECRET', '')
param entraRedirectUri = readEnvironmentVariable(
  'AXIOMATE_ENTRA_REDIRECT_URI',
  'https://axiomate-axiocloud.azurewebsites.net/api/auth/callback'
)

/* -------------------------------------------------------------------------------------------- *
 * The assistant and telemetry
 * -------------------------------------------------------------------------------------------- */

param anthropicApiKey = readEnvironmentVariable('ANTHROPIC_API_KEY', '')

// Empty omits the connection string and the agent extension together. Application Insights on
// a Basic plan measures an instance that is already CPU-bound, so this is turned on when there
// is a question to answer rather than by default.
param appInsightsConnectionString = readEnvironmentVariable('APPLICATIONINSIGHTS_CONNECTION_STRING', '')
