/*
  Axiomate — the whole estate, in one deployment.

    az deployment group create -g <resource-group> -f infra/main.bicep \
      -p postgresAdministratorLoginPassword=... intakeToken=... scheduleToken=...

  Six modules, one resource group: telemetry, the database, the web app, the vault that holds the
  application's secrets, the daily scheduled pass, and — when a mailbox is named — mail intake.
  Every module in this repository can still be deployed on its own with its own parameter file;
  this file is the composition, and it is the only place that knows how the pieces are wired to
  each other.

  ---------------------------------------------------------------------------------------------
  1. The ordering, and the cycle that appeared not to have one

  Read as resources rather than as data, the App Service and the vault look mutually dependent:
  the app's settings point at vault secrets, and the vault's role assignment points at the app's
  managed identity. Neither can go first.

  Read as data, the cycle is not there. What the app needs from the vault is not a resource, a
  URI or an output — it is six strings of the form

      @Microsoft.KeyVault(VaultName=<name>;SecretName=<secret>)

  and every ingredient of those strings is known before anything is deployed. The vault's *name*
  is a parameter of this file (`keyvault.bicep` says so itself: the name is owned by main, because
  a name derived inside that module would change when the resource group did). The secret names
  are a compile-time import from the same module. So the app has no deployment-time dependency on
  the vault at all, and the one real edge runs the other way: the grant needs a principal id that
  only exists once the app has been created.

  Hence the order below — observability and Postgres first, because nothing waits on them; then
  the app; then the vault, which grants the app's identity read access as the last step of its own
  deployment; then the two Logic Apps, which need the app's host name.

  The alternative resolution, and why this one instead. The usual answer is to deploy the vault
  without a grant, then the app, then a role assignment declared here against an `existing` vault.
  It works, and it is the right answer when the app genuinely needs something the vault produces —
  a `SecretUri`, a data-plane endpoint, a reference built from `vault.properties.vaultUri`. It is
  not needed here, and taking it would mean deleting the grant from `keyvault.bicep`, where the
  argument for what it grants and what it deliberately does not is written down next to the role
  id it uses. Moving thirty lines of reasoning into the orchestrator to solve a dependency that
  the `VaultName=` reference form does not create would be a worse file and a worse vault module.

  What both resolutions share, and what nothing can remove: the app is created before it can read
  the vault. Key Vault references resolve on a schedule of App Service's own — at start-up, on a
  configuration change, and roughly daily thereafter — and until the role assignment has both been
  made and propagated, an unresolved reference is delivered to the process as the literal
  `@Microsoft.KeyVault(...)` string rather than as an empty value. So a first deployment produces
  an application that is not merely unconfigured but misconfigured, until it is restarted once the
  grant exists. The deployment output below says so; `docs/secrets.md` is where the restart lives.

  ---------------------------------------------------------------------------------------------
  2. What this deployment deliberately does not do

  It does not put a secret in the vault. `keyvault.bicep` explains at length why the vault's
  contents are written out of band by a person, and composing the estate does not change that
  argument. A fresh deployment therefore comes up with six unresolved references, an assistant
  that answers offline, closed intake and a workspace running from the seed file — which is a
  working system in the degraded sense Axiomate is built for, and is not a finished install.

  It does not create the network the database asks for. `postgres.bicep` defaults to Private
  access and requires a delegated subnet and a private DNS zone, and there is no network module in
  this repository to produce them; those two resource ids are parameters here and the deployment
  fails, loudly and before the database exists, when Private is asked for without them. Worth
  reading the note on `networkAccess` below before choosing, because the choice is a rebuild.

  It does not register anything in Entra, authorise the mailbox connection, or run a migration.
  Those are three human acts, and the outputs at the foot of this file name all three.
*/

targetScope = 'resourceGroup'

/*
  The mapping and the reference format, imported rather than restated.

  This is the mechanism that breaks the ordering cycle: an import is resolved by the compiler, so
  reading these costs no dependency on the vault module's deployment. Taking the same two facts
  from `keyvault.outputs.secretReferences` would be the tidier-looking line and would put the
  cycle straight back — the app cannot wait for a module that is waiting for the app.
*/
import { secretNames, secretReference } from './keyvault.bicep'

/* ============================================================================================ *
 * Names and placement
 *
 * Every name is spelled out rather than derived from a prefix and a `uniqueString()`. Three of
 * them are globally unique across Azure and two of those are effectively permanent: the vault
 * name is held for ninety days after a deletion by purge protection, and the app's host name is
 * registered in Entra and typed into people's bookmarks. A generated name would make a rebuild in
 * a new resource group produce a different estate with the same template, which is the opposite
 * of what these particular names are for.
 * ============================================================================================ */

@description('Host name of the Web App, and the first half of its default URL. Changing it invalidates the Entra redirect URI registered against it.')
@minLength(2)
@maxLength(60)
param appName string = 'axiomate-axiocloud'

@description('App Service plan. Renaming it on an existing deployment creates a second plan and bills for both.')
@minLength(1)
@maxLength(40)
param planName string = 'asp-axiomate-axiocloud'

@description('Key Vault name. Globally unique, and unrecoverable for ninety days if deployed by mistake — see the purge-protection note in keyvault.bicep. Get it right the first time.')
@minLength(3)
@maxLength(24)
param keyVaultName string = 'kv-axiomate-axiocloud'

@description('PostgreSQL flexible server. Becomes the public DNS name `<name>.postgres.database.azure.com`, so it is globally unique whether or not the server has a public endpoint.')
@minLength(3)
@maxLength(63)
param postgresServerName string = 'psql-axiomate-prod'

@description('Prefix for the Log Analytics workspace and Application Insights component, which are named `<prefix>-logs` and `<prefix>-insights` so the pair reads as one deployment.')
@minLength(3)
@maxLength(24)
param observabilityNamePrefix string = 'axiomate-axiocloud'

@description('Region for everything. One region for the whole estate is not tidiness: the app renders through several Prisma round trips per page, and telemetry ingested across a region boundary is billed as egress.')
param location string = resourceGroup().location

/*
  Tags, and the one thing they are for.

  Nothing in Azure separates this workload's bill from anything else in the subscription except
  these. Each module is passed the same set plus a `component`, so a cost report can answer both
  "what does Axiomate cost" and "what does the database cost" without anyone opening a template.
*/
@description('Applied to every resource in the estate, with a per-module `component` tag added.')
param tags object = {
  application: 'axiomate'
  tenant: 'axiocloud'
  environment: 'production'
  managedBy: 'bicep'
}

/* ============================================================================================ *
 * The web tier
 * ============================================================================================ */

@description('Plan size. B1 is the smallest tier that supports Always On and a custom domain; P0v3 is the step up and is what buys deployment slots, so that a deploy stops interrupting whoever is mid-edit. See app.bicep for what each tier does and does not buy.')
param appSkuName string = 'B1'

@description('Instances. Above 1 the first render against an empty database can race itself while seeding, and each instance opens its own Postgres pool against a server that only offers 35 connections at the default tier.')
@minValue(1)
@maxValue(10)
param appInstanceCount int = 1

/*
  On, because the build this estate deploys serves it. `app.bicep` defaults this off — a module
  cannot know what is in the artifact pointed at it, and a health check against a route that 404s
  removes healthy instances from rotation. This file can know: it deploys the Axiomate application
  in this repository, whose `/api/health` answers anonymously and treats an unset DATABASE_URL as
  healthy rather than as a fault, which is exactly what makes it safe to poll.
*/
@description('Path App Service polls to decide an instance is healthy. Empty disables the check.')
param healthCheckPath string = '/api/health'

@description('Which delivery firm this deployment serves. This is the application\'s own tenancy slug — not the Entra directory, and not the vault\'s tenant. Changing it points the app at a different tenant partition, so the existing workspace disappears from view without being deleted.')
param tenantSlug string = 'axiocloud'

@description('Name written into the audit trail when no identity provider is configured. Set it. Left empty, every entry is attributed to a default operator — a person who has never touched the system — which is worse than an unattributed trail.')
param operatorName string = ''

/* ============================================================================================ *
 * Sign-in
 *
 * Two ids here and one secret in the vault. All four have to be present for sign-in to work, and
 * with any one missing the application runs as the operator above and shows no sign-in screen it
 * cannot satisfy — so a half-configured directory is a deployment that works and does not
 * authenticate, rather than one that fails.
 * ============================================================================================ */

@description('Entra directory the firm\'s people sign in from. Usually the subscription\'s own, and not required to be.')
param entraTenantId string = ''

@description('Entra application (client) id of the registration for this deployment.')
param entraClientId string = ''

/*
  Derived from `appName`, which is legitimate here and is not in `app.bicep`.

  The module takes this as a parameter because building it inside the app settings from the site's
  own host name would be a self-reference — a resource reading a property of itself. This file is
  not the resource: it composes the name, so it can compose the URI from the same parameter and
  the two cannot drift. What it cannot know is a custom domain, which is why this stays a
  parameter with a default rather than a variable.
*/
@description('Redirect URI registered against the Entra application. Defaults to the default host name; override it when the app answers on a custom domain, and register whatever this ends up being — a mismatch fails the callback after the user has already signed in.')
param entraRedirectUri string = 'https://${appName}.azurewebsites.net/api/auth/callback'

/* ============================================================================================ *
 * The database
 * ============================================================================================ */

/*
  Required, with no default, and it is the only secret this file asks a human for that the vault
  also holds. The server needs it at creation; there is nowhere else it can come from.

  It is not read back out of the vault with `getSecret()`, which is the pattern that would avoid
  the second copy, because that function requires `enabledForTemplateDeployment` on the vault and
  `keyvault.bicep` sets that property false on purpose — see the argument there. Supply it from a
  shell variable rather than a parameter file, as `postgres.bicepparam` does, so it lands in
  neither source control nor the deployment history.
*/
@description('Administrator password for the Postgres server. Supplied at deployment, never defaulted and never written to a parameter file. The same value belongs in the vault as `axiomate-database-url`, inside the connection string the application reads.')
@secure()
param postgresAdministratorLoginPassword string

@description('Object id of the Entra group that administers the database. A group, not a person: removing somebody from it is the whole of revoking their access. Empty creates the server with no Entra administrator, and nobody can add one later without being one.')
param postgresEntraAdministratorObjectId string = ''

@description('Display name of that group, recorded on the server so the portal shows who holds the role rather than a bare GUID.')
param postgresEntraAdministratorName string = ''

/*
  Private by default, following the module, and this is the one parameter on this page that cannot
  be changed after the server exists.

  Private costs the two resource ids below and the ability to run `npm run db:migrate` from a
  laptop. PublicWithFirewall costs a public endpoint on the firm's database. There is no network
  module here to produce the subnet and the zone, so Private with both ids empty fails the
  deployment at the database rather than producing something that half works — which is the
  correct failure, and it happens before the server is created rather than after.
*/
@description('How the database is reached. Private integrates it into a virtual network; PublicWithFirewall gives it a public endpoint. CANNOT BE CHANGED AFTER CREATION — the wrong choice here is a rebuild and a dump and restore.')
@allowed([
  'Private'
  'PublicWithFirewall'
])
param postgresNetworkAccess string = 'Private'

@description('Resource id of the subnet delegated to Microsoft.DBforPostgreSQL/flexibleServers. Required when the database is Private.')
param postgresDelegatedSubnetResourceId string = ''

@description('Resource id of the privatelink.postgres.database.azure.com zone, linked to that subnet\'s virtual network. Required when the database is Private; without it the server\'s name resolves to nothing from inside the network, which presents as a timeout rather than as a misconfiguration.')
param postgresPrivateDnsZoneResourceId string = ''

@description('A single client address allowed through the firewall when the database is PublicWithFirewall — an office or VPN egress address, so migrations can be run. Ignored when Private.')
param postgresClientIpAddress string = ''

/* ============================================================================================ *
 * The two Logic Apps, and the two tokens they carry
 *
 * Both endpoints authenticate a bearer token, and both workflows have to hold the literal value:
 * a Logic App resolves no Key Vault reference, and the workflow parameter is the only place the
 * value can live.
 *
 * `intake.bicep` and `schedule.bicep` both instruct the caller to supply these with
 * `vault.getSecret(...)`. That instruction cannot be followed against this vault, and the reason
 * is a deliberate decision in the other module rather than an oversight in this one: `getSecret`
 * requires `enabledForTemplateDeployment`, and `keyvault.bicep` sets it false precisely so that no
 * deployment can read secrets out of the vault and into a template's parameters. So the tokens are
 * supplied at deployment instead, `@secure()` and without defaults, which keeps them out of source
 * control and out of the deployment history but does not keep them to one copy.
 *
 * The cost of that, stated because it is silent when it goes wrong: the app reads these two tokens
 * from the vault, and the Logic Apps get whatever is passed here. Pass a different string from the
 * one written into `axiomate-intake-token` or `axiomate-schedule-token` and every call is refused
 * with 401 — which looks like a quiet mailbox in the first case, and like a scheduler that has
 * simply not run in the second. Both are values a person copies twice; `docs/secrets.md` is where
 * they are generated once.
 * ============================================================================================ */

@description('Bearer token the scheduled pass accepts. Must equal the vault\'s `axiomate-schedule-token`, which is what the application checks it against.')
@secure()
param scheduleToken string

@description('Bearer token the intake endpoint requires. Must equal the vault\'s `axiomate-intake-token`. Ignored when no mailbox is named below, but still required — a parameter that defaults to empty is one somebody forgets, and a forgotten intake token deploys a connector that 401s every message it ever receives.')
@secure()
param intakeToken string

/*
  Intake is the one optional piece of the estate, and the mailbox address is what switches it on.

  It is gated on the address rather than on a boolean because the address is not optional to
  intake: the workflow watches one named mailbox and sends that same address as the payload's
  `to`, where the application matches it exactly against what is configured under Routing &
  intake. A boolean plus an empty address would deploy a connector that refuses every message with
  422. Absent an address there is nothing to deploy.
*/
@description('Shared mailbox the intake connector watches, e.g. support@axiocloudsolutions.com. Empty deploys no intake at all. The address must also be configured in the application under Configuration → Routing & intake, exactly, or every message is refused.')
param intakeMailbox string = ''

@description('Where a failed scheduled run is emailed. Empty still raises the alert in Azure Monitor, where it reaches nobody actively.')
param alertEmail string = ''

var deployIntake = !empty(intakeMailbox)

/* ============================================================================================ *
 * Telemetry, first, because nothing waits on it and two things want it
 *
 * The workspace is wired to both the app — as an Application Insights connection string — and to
 * the vault, as the destination for its audit log. The second is the one worth naming: the vault
 * records every secret read with the identity that made it, and nothing else in this system
 * answers "who read this, and when". Without a workspace to send it to, that record does not
 * exist to be looked at later.
 * ============================================================================================ */

module observability './observability.bicep' = {
  name: 'observability'
  params: {
    namePrefix: observabilityNamePrefix
    location: location
    tags: union(tags, { component: 'observability' })
  }
}

/* ============================================================================================ *
 * The database
 *
 * Deployed alongside the app rather than before it, because nothing connects them at deployment
 * time. The application reaches Postgres through DATABASE_URL, and DATABASE_URL is a vault secret
 * written by a person — this template never assembles one, because the assembled string contains
 * the administrator password and a deployment output is readable by anyone holding reader on the
 * resource group. `databaseConnectionStringShape` at the foot of this file is the form to fill in.
 * ============================================================================================ */

module postgres './postgres.bicep' = {
  name: 'postgres'
  params: {
    name: postgresServerName
    location: location
    tags: union(tags, { component: 'database' })
    administratorLoginPassword: postgresAdministratorLoginPassword
    entraAdministratorObjectId: postgresEntraAdministratorObjectId
    entraAdministratorPrincipalName: postgresEntraAdministratorName
    networkAccess: postgresNetworkAccess
    delegatedSubnetResourceId: postgresDelegatedSubnetResourceId
    privateDnsZoneResourceId: postgresPrivateDnsZoneResourceId
    clientIpAddress: postgresClientIpAddress
    // Deliberately left at the module's defaults: Postgres 18 on a Standard_B1ms Burstable with
    // 32 GiB and fourteen days of backups. Restating them here would fork the argument for them
    // away from the file that makes it.
  }
}

/* ============================================================================================ *
 * The web app
 *
 * Every secret setting is a Key Vault reference, built from the vault name this file owns and the
 * secret names imported from the vault module. Not one secret value passes through this template.
 *
 * These strings are legal, and inert, before the vault exists — which is the whole reason the
 * ordering works. They stay inert until the grant below has been made and the app has restarted.
 * ============================================================================================ */

module app './app.bicep' = {
  name: 'app'
  params: {
    appName: appName
    planName: planName
    location: location
    tags: union(tags, { component: 'web' })
    skuName: appSkuName
    instanceCount: appInstanceCount
    healthCheckPath: healthCheckPath
    tenantSlug: tenantSlug
    operatorName: operatorName
    entraTenantId: entraTenantId
    entraClientId: entraClientId
    entraRedirectUri: entraRedirectUri
    databaseUrl: secretReference(keyVaultName, secretNames.DATABASE_URL)
    sessionSecret: secretReference(keyVaultName, secretNames.AXIOMATE_SESSION_SECRET)
    scheduleToken: secretReference(keyVaultName, secretNames.AXIOMATE_SCHEDULE_TOKEN)
    intakeToken: secretReference(keyVaultName, secretNames.AXIOMATE_INTAKE_TOKEN)
    entraClientSecret: secretReference(keyVaultName, secretNames.AXIOMATE_ENTRA_CLIENT_SECRET)
    anthropicApiKey: secretReference(keyVaultName, secretNames.ANTHROPIC_API_KEY)
    /*
      The connection string is not a Key Vault reference and does not belong in the vault. It
      authorises writing telemetry into this workspace and reading none of it, it is not one of
      the six values that let somebody do something they otherwise could not, and putting it
      behind a reference would cost a vault lookup on every cold start to protect a value the
      same people can already read in the portal.
    */
    appInsightsConnectionString: observability.outputs.connectionString
  }
}

/* ============================================================================================ *
 * The vault, and the grant that is the only real edge in this file
 *
 * Deployed after the app because the role assignment inside it needs the app's managed identity,
 * which does not exist until the site does. Nothing about the vault is needed to build the app —
 * see the note at the top — so this is a one-way dependency rather than half of a cycle.
 *
 * Role assignments take a minute or two to propagate, and App Service caches an unresolved
 * reference. So the deployment finishing is not the app working: it needs one restart afterwards,
 * and it needs the six secrets to have been written by a person first.
 * ============================================================================================ */

module keyVault './keyvault.bicep' = {
  name: 'keyvault'
  params: {
    name: keyVaultName
    location: location
    tags: union(tags, { component: 'secrets' })
    appIdentityPrincipalId: app.outputs.principalId
    logAnalyticsWorkspaceId: observability.outputs.workspaceId
  }
}

/* ============================================================================================ *
 * The scheduled pass
 *
 * Deployed unconditionally, and that follows `schedule.bicep` rather than being an oversight: the
 * pass already has an on/off switch on its own configuration screen, and that one is better,
 * because turning it off there leaves the previous observation untouched instead of announcing a
 * month of accumulated conditions the day it comes back on. An infrastructure switch would look
 * equivalent and would not be.
 *
 * It calls the app over its public host name rather than from inside anything, so it needs the
 * app deployed and nothing else.
 * ============================================================================================ */

module schedule './schedule.bicep' = {
  name: 'schedule'
  params: {
    location: location
    tags: union(tags, { component: 'schedule' })
    appHostName: app.outputs.defaultHostName
    scheduleToken: scheduleToken
    alertEmail: alertEmail
    // Hour, minute, time zone and first-run date are left to the module, which argues for 07:00
    // GMT Standard Time at length and bounds the hour away from the midnight-in-BST case where
    // the pass would read the workspace as of yesterday, every night, permanently.
  }
}

/* ============================================================================================ *
 * Mail intake
 *
 * Deploys inert. The Office 365 connection is created without credentials because OAuth consent
 * is a human act, so the workflow polls nothing until somebody opens the connection and presses
 * Authorise — as a service account with access to the mailbox, not as whoever ran the deployment,
 * or intake stops the day that person leaves. `intakeConnectionToAuthorise` below is the link.
 * ============================================================================================ */

module intake './intake.bicep' = if (deployIntake) {
  name: 'intake'
  params: {
    location: location
    tags: union(tags, { component: 'intake' })
    appHostName: app.outputs.defaultHostName
    mailboxAddress: intakeMailbox
    intakeToken: intakeToken
  }
}

/* ============================================================================================ *
 * What the deployment tells the operator
 *
 * No secret is echoed here, and no assembled connection string: outputs are recorded in the
 * resource group's deployment history and are readable by anyone with reader on the group.
 *
 * The first four are the acts a person still has to perform. A deployment that reports success
 * has not finished installing Axiomate, and these are the difference.
 * ============================================================================================ */

@description('1. Write the six secrets into this vault — see docs/secrets.md. Until then the app runs with unresolved references: no database, no sessions, no assistant, closed intake.')
output vaultToFill string = keyVault.outputs.vaultName

@description('2. The shape of DATABASE_URL to store as the vault\'s `axiomate-database-url`, with the administrator password substituted in and `sslmode=require` kept. It is a shape and not a value on purpose — a real connection string in a deployment output is a credential published to everyone who can list deployments.')
output databaseConnectionStringShape string = postgres.outputs.prismaConnectionStringShape

@description('3. Register this exact URI against the Entra application, and check it matches the entraRedirectUri parameter. A mismatch fails the callback after the user has already authenticated, which reads as a broken application rather than as a misconfigured one.')
output redirectUriToRegister string = app.outputs.expectedEntraRedirectUri

@description('4. Open this and press Authorise, or no mail will ever arrive. Empty when no mailbox was named and intake was therefore not deployed.')
output intakeConnectionToAuthorise string = deployIntake ? intake.outputs.authoriseConnectionUrl : ''

@description('Base URL of the application. Expect unresolved secret references until the vault is filled and the app has been restarted once, so that the role assignment made by this deployment is picked up.')
output appUrl string = app.outputs.appUrl

@description('The endpoint the scheduled pass calls, and when. Worth comparing against the run history the first morning after a deployment.')
output scheduleRuns string = '${schedule.outputs.endpointUrl} at ${schedule.outputs.runsAt}'

@description('Hostname of the database server. Resolves only inside the linked virtual network when the deployment is Private, which is also why a migration cannot be run from a laptop in that mode.')
output databaseHostName string = postgres.outputs.fullyQualifiedDomainName

@description('Which mailbox intake watches, so it can be compared with the application\'s Routing & intake configuration without opening a template. Empty when intake was not deployed.')
output intakeWatchedMailbox string = deployIntake ? intake.outputs.watchedMailbox : ''

@description('Whether Always On was applied. False means the chosen plan cannot support it, and the first request after twenty minutes idle pays a cold start that the browser\'s autosave retry budget may not survive.')
output alwaysOnEnabled bool = app.outputs.alwaysOnEnabled
