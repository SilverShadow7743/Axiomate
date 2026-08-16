// Axiomate — the Postgres the application persists to.
//
// This module deploys one Azure Database for PostgreSQL Flexible Server, one database on it,
// the Microsoft Entra administrator that governs access to it, and — only when the caller asks
// for public networking — the firewall rules that let anything reach it. It deploys nothing
// else. The virtual network, the private DNS zone, the App Service and the key vault belong to
// other modules and to the orchestrator that composes them; this file takes what it needs as
// parameters and hands back what a consumer needs as outputs.
//
// ---------------------------------------------------------------------------
// Four things this module decides, and why
//
// 1. POSTGRES 18, NOT 16.
//    `prisma/schema.prisma` is developed against 18 and the application's own `.env.example`
//    only claims 14 or later, so anything from 16 up would run. 18 is chosen because it is
//    generally available on this service, it is the version the schema is exercised against
//    locally, and its Azure standard support runs to November 2030 — where 16 ends in November
//    2028. Choosing 16 to be conservative would buy nothing and would spend a major version
//    upgrade in two years to get back to where the developers already are. The version is a
//    parameter because an in-place major version upgrade is a real operation with real
//    preconditions, and pinning it here is what makes that upgrade a deliberate, reviewed edit
//    rather than something a redeployment does on its own.
//
// 2. CONNECTIONS ARE THE BINDING CONSTRAINT AT THIS TIER, AND THIS FILE CANNOT FIX IT.
//    A B1ms has 1 vCore and 2 GiB of memory, which gives `max_connections` a default of 50, of
//    which 15 are reserved for replication and monitoring. The application gets 35.
//
//    `@prisma/adapter-pg` hands `PrismaPg` a connection string and nothing else (see
//    `lib/db/client.ts`), so the pool underneath is a node-postgres pool at its default size —
//    `max: 10`, read from `node_modules/pg/lib/defaults.js` at pg 8.23.0, not from memory. That
//    is ten connections per App Service instance. Three instances is thirty of the thirty-five
//    before anybody runs `npm run db:migrate` or opens psql to look at something. Four
//    instances exhausts the server, and the symptom is `FATAL: sorry, too many clients already`
//    on whichever request happens to arrive next.
//
//    Prisma's `connection_limit` URL parameter does NOT apply here. That parameter configures
//    the Rust query engine's pool, and a driver adapter replaces that pool entirely; adding it
//    to `DATABASE_URL` would look like a fix and change nothing. The two real answers are to
//    pass `max` to `PrismaPg` in `lib/db/client.ts` — a one-line change in a file this module
//    does not own — or to raise `skuTier` to GeneralPurpose, where the smallest size carries
//    859 connections.
//
//    The built-in PgBouncer is not a third answer at this tier. It is unavailable on Burstable:
//    `pgbouncer.enabled` is hidden on Burstable servers, and a server scaled down from General
//    Purpose to Burstable loses the capability. This is stated rather than assumed — raising
//    the tier is what buys PgBouncer, and at that point the pooler and the larger
//    `max_connections` arrive together.
//
// 3. TLS IS THE SERVER'S DEFAULT AND THE CLIENT'S RESPONSIBILITY.
//    The service enforces encrypted connections out of the box (`require_secure_transport` is
//    ON, and TLS 1.0 and 1.1 are refused), so this module sets no server parameter to obtain
//    it. What the application must do is ask for it: `DATABASE_URL` needs `?sslmode=require`,
//    which is why the connection-string shape below carries it.
//
//    That value is set in exactly two places and read in two more. It is an App Service
//    application setting in production — owned by the App Service module, not this one — and a
//    line in `.env` locally. It is read by `lib/db/client.ts`, which passes it straight to
//    `PrismaPg`, and by `prisma.config.ts`, which is what `npm run db:migrate` connects with.
//    A migration run against a URL missing `sslmode` fails in a different place from the app,
//    so both need it.
//
//    Worth knowing rather than discovering: on the installed driver
//    (`pg-connection-string` 2.14.0) `sslmode=require` is treated as an alias for `verify-full`
//    and emits a deprecation warning on first use. Azure's server certificate chains to roots
//    already in the system trust store, so full verification succeeds without `sslrootcert`.
//    That alias goes away in pg 9, where `require` takes libpq's weaker meaning — when this
//    repository upgrades `pg`, `sslmode=verify-full` is the value that keeps today's behaviour.
//
// 4. PRIVATE NETWORKING IS THE DEFAULT, AND IT IS NOT FREE.
//    See `networkAccess` below for what the safer default costs to set up. The short version is
//    that it costs a virtual network, and it costs the ability to run a migration from a laptop.

@description('Name of the flexible server. Forms the hostname `<name>.postgres.database.azure.com`, so it must be globally unique across Azure, not merely unique in the subscription.')
@minLength(3)
@maxLength(63)
param name string

@description('Region for the server. Defaults to the resource group\'s region because a database in a different region from the App Service that reads it pays that latency on every query.')
param location string = resourceGroup().location

@description('Tags applied to the server. The orchestrator owns the tagging convention; this module only passes them through.')
param tags object = {}

@description('Major PostgreSQL version. 18 is what the schema is developed against. Lowering this is a downgrade the service cannot perform in place — it means a new server and a dump and restore — so treat a change here as a migration, not a setting.')
@allowed([
  '16'
  '17'
  '18'
])
param postgresVersion string = '18'

@description('Compute tier. Burstable is the default and is a development-grade tier: it has no high availability, no on-demand backups and no built-in PgBouncer. Raising it to GeneralPurpose roughly triples the compute bill and buys all three, plus an order of magnitude more connections. Raise `skuName` to a matching size when you raise this.')
@allowed([
  'Burstable'
  'GeneralPurpose'
  'MemoryOptimized'
])
param skuTier string = 'Burstable'

@description('Compute size, which must belong to the tier above — B-series for Burstable, D-series for GeneralPurpose, E-series for MemoryOptimized. Standard_B1ms is 1 vCore and 2 GiB, which is enough for a consulting firm\'s issue log and is the reason the connection ceiling is 35. Scaling compute is an online operation with a restart; it is the cheapest of the changes on this page to reverse.')
param skuName string = 'Standard_B1ms'

@description('Provisioned storage in GiB. Only the sizes the service provisions at are accepted — it grows in doublings, so an existing server can also be scaled to intermediate sizes this list does not offer — and storage can only ever grow — shrinking means a new server and a dump and restore. 32 GiB is the floor and is ample for this workload; the cost of raising it is roughly linear in the size, and raising it also raises the free backup allowance, since backup storage is only charged above the provisioned size.')
@allowed([
  32
  64
  128
  256
  512
  1024
  2048
  4096
  8192
  16384
  32767
])
param storageSizeGB int = 32

@description('Days of point-in-time restore history. The service allows 7 to 35 and defaults to 7; 14 is chosen because a fortnight covers a problem noticed after a holiday, which 7 does not. Each extra day costs only the backup storage it consumes, and only the part exceeding the provisioned storage size is billed — at this data volume, raising this to 35 is very likely to cost nothing at all.')
@minValue(7)
@maxValue(35)
param backupRetentionDays int = 14

@description('Whether backups are also copied to the Azure paired region. Off by default: it roughly doubles the billed backup size, and it protects against losing a whole region, which is a risk a single-region consulting workload has already accepted by running one server with no high availability. The cost of leaving it off is not money — this CANNOT BE CHANGED AFTER CREATION, so turning it on later means building a new server and migrating onto it.')
param geoRedundantBackup bool = false

@description('Name of the database the application connects to. Defaults to `axiomate`, which is what `.env.example` and `prisma.config.ts` assume.')
@minLength(1)
@maxLength(63)
param databaseName string = 'axiomate'

@description('The password-based administrator login. Letters and digits only — the service rejects underscores here, which is why this is not `axiomate_admin` — and it may not start with `pg_` or be one of the reserved names. Fixed for the life of the server once password authentication has been enabled, so it cannot be corrected later by editing this parameter.')
param administratorLogin string = 'axiomateadmin'

@description('Password for the administrator login above. Taken as a parameter and never generated here: a template that mints a password puts it in the deployment history, where it outlives every rotation.')
@secure()
param administratorLoginPassword string

@description('Object id of the Entra principal made administrator of the server — a group is the right answer, a named person is a single point of failure. Leave empty to create the server without an Entra administrator; Entra authentication is still enabled, but nobody can yet use it, and nobody can grant it either, because only an Entra administrator may create Entra roles.')
param entraAdministratorObjectId string = ''

@description('Display name of that principal — the group name or user principal name. Recorded on the server so an operator reading the portal sees who holds the administrator role rather than a bare GUID.')
param entraAdministratorPrincipalName string = ''

@description('What kind of principal the object id above refers to. Getting this wrong is not a validation error, it is an administrator that cannot sign in.')
@allowed([
  'Group'
  'ServicePrincipal'
  'User'
])
param entraAdministratorPrincipalType string = 'Group'

@description('Directory that governs database access. Defaults to the subscription\'s tenant, which is the Axiocloud Solutions tenant that already issues the application\'s sign-in tokens — the same directory governing the application and its database is the point of enabling Entra authentication at all.')
param entraTenantId string = subscription().tenantId

@description('How the server is reached. `Private` integrates it into a virtual network and gives it no public endpoint. `PublicWithFirewall` gives it a public endpoint reachable only from the addresses named below. Private is the default and the safer choice; what it costs is set-up, not money: a virtual network with a subnet delegated to Microsoft.DBforPostgreSQL/flexibleServers, a privatelink.postgres.database.azure.com zone linked to that network, regional VNet integration for the App Service in a SEPARATE subnet, and the loss of `npm run db:migrate` from anybody\'s laptop — migrations then need a jump box, a VPN, or a runner inside the network. THIS CANNOT BE CHANGED AFTER CREATION: the service does not support moving a server in or out of a virtual network, so the wrong choice here is a rebuild.')
@allowed([
  'Private'
  'PublicWithFirewall'
])
param networkAccess string = 'Private'

@description('Resource id of the subnet the server is injected into. Required when `networkAccess` is Private, ignored otherwise. The subnet must be delegated to Microsoft.DBforPostgreSQL/flexibleServers and must hold no other resource type.')
param delegatedSubnetResourceId string = ''

@description('Resource id of the private DNS zone that resolves the server\'s hostname, which must be named privatelink.postgres.database.azure.com and must be linked to the virtual network above. Required when `networkAccess` is Private, ignored otherwise. Without it the name resolves to nothing from inside the network, which presents as a timeout rather than as a configuration error.')
param privateDnsZoneResourceId string = ''

@description('Whether to allow connections from Azure services when `networkAccess` is PublicWithFirewall. This is the 0.0.0.0 rule, and it is broader than it sounds: it admits any Azure tenant, not only this one. It is on by default because it is what lets an App Service without VNet integration connect at all, which is the only reason to have chosen public access.')
param allowAzureServices bool = true

@description('A single client address allowed through the firewall when `networkAccess` is PublicWithFirewall — an office or VPN egress address, so an operator can run migrations and psql. Leave empty to add no such rule. A range is deliberately not offered: the narrower the rule, the more honest it is about who can reach the database.')
param clientIpAddress string = ''

// Private access and public access are mutually exclusive on this service, and a
// virtual-network-integrated server does not accept firewall rules at all — network security
// groups on the subnet are what filter it instead. So the two configurations are built as two
// disjoint objects rather than one object with blanks in it: an empty `delegatedSubnetResourceId`
// is not "no subnet", it is a malformed resource id.
//
// `publicNetworkAccess` is deliberately absent from the private branch. The service documents it
// as meaningful only for servers that are not integrated into a virtual network, and setting it
// alongside a delegated subnet is the combination the service refuses.
var networkConfiguration = networkAccess == 'Private'
  ? {
      delegatedSubnetResourceId: delegatedSubnetResourceId
      privateDnsZoneArmResourceId: privateDnsZoneResourceId
    }
  : {
      publicNetworkAccess: 'Enabled'
    }

var deployFirewallRules = networkAccess == 'PublicWithFirewall'

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    version: postgresVersion
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorLoginPassword

    // Both authentication methods, not one. Entra is what the firm's people and the App Service's
    // managed identity should use, and it is what makes database access revocable by removing
    // somebody from a group. Password authentication stays on because the Entra administrator is
    // the only principal that can create Entra roles, and because `prisma migrate deploy` from a
    // pipeline is far simpler to make work with a password than with a token that expires
    // mid-migration. Disabling `passwordAuth` is the right end state and is one word here — but
    // it is a change to make after Entra roles exist, not before, or the server locks everyone out.
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Enabled'
      tenantId: entraTenantId
    }

    storage: {
      storageSizeGB: storageSizeGB
      type: 'Premium_LRS'
      // On for a server nobody watches daily. The alternative — leaving it off and relying on a
      // storage alert — is the option that ends with the server read-only at 95% full on a
      // Saturday. The cost is that Premium SSD grows by doubling, so the first trigger takes
      // 32 GiB to 64 GiB and doubles the storage line of the bill with it.
      autoGrow: 'Enabled'
    }

    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: geoRedundantBackup ? 'Enabled' : 'Disabled'
    }

    // Stated rather than omitted, because the omission would read as an oversight. The Burstable
    // tier cannot do high availability at all, and on a raised tier this module still would not:
    // a standby doubles the compute bill to remove an outage of a few minutes, which is not the
    // trade a firm of this size is making. Enabling it later is an online operation, but only
    // once the tier has been raised — on Burstable it is not a switch that can be thrown at all.
    highAvailability: {
      mode: 'Disabled'
    }

    network: networkConfiguration
  }
}

// The administrator's resource name IS the principal's object id, so an empty parameter would
// produce an invalid name rather than a skipped resource. Hence the condition.
resource entraAdministrator 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2025-08-01' = if (!empty(entraAdministratorObjectId)) {
  parent: postgres
  name: entraAdministratorObjectId
  properties: {
    principalName: entraAdministratorPrincipalName
    principalType: entraAdministratorPrincipalType
    tenantId: entraTenantId
  }
}

// `parent` establishes that this comes after the server; `dependsOn` establishes that it comes
// after the administrator. Both are server-level operations, and the service processes them one
// at a time — issued in parallel, the loser returns a conflict and fails the deployment. Ordering
// the administrator, then the database, then the firewall rules costs a minute of deployment time
// and removes a class of intermittent failure that only shows up on some deployments.
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2025-08-01' = {
  parent: postgres
  name: databaseName
  properties: {
    charset: 'UTF8'
    // en_US.utf8 rather than a British locale, because collation determines sort order and
    // changing it later requires reindexing every text index in the schema. This is the collation
    // the service creates servers with and the one a local Postgres will match, so a dump taken
    // here restores there without a sort-order surprise.
    collation: 'en_US.utf8'
  }
  dependsOn: [
    entraAdministrator
  ]
}

resource allowAzureServicesRule 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2025-08-01' = if (deployFirewallRules && allowAzureServices) {
  parent: postgres
  // The 0.0.0.0-to-0.0.0.0 range is not an address range; it is the service's sentinel for
  // "allow Azure-internal traffic". The name is the one the portal uses, so an operator reading
  // the firewall list sees the same wording there as here.
  name: 'AllowAllAzureServicesAndResourcesWithinAzure'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
  dependsOn: [
    database
  ]
}

resource allowClientIpRule 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2025-08-01' = if (deployFirewallRules && !empty(clientIpAddress)) {
  parent: postgres
  name: 'AllowNamedClient'
  properties: {
    startIpAddress: clientIpAddress
    endIpAddress: clientIpAddress
  }
  // On `database` rather than on the rule above, which is conditional. Both rules therefore hang
  // off something that always exists, and neither branch of `allowAzureServices` can leave this
  // one waiting on a resource that was never deployed.
  dependsOn: [
    database
  ]
}

@description('Hostname to connect to. Resolves publicly under PublicWithFirewall, and only inside the linked virtual network under Private.')
output fullyQualifiedDomainName string = postgres.properties.fullyQualifiedDomainName

@description('The database the application connects to, echoed back so a consumer builds its connection string from what was deployed rather than from what it assumed.')
output databaseName string = databaseName

@description('The shape of DATABASE_URL, with the password left as a placeholder. A shape rather than the value: deployment outputs are readable by anyone with reader access on the resource group, so a real connection string here would be a credential published to everybody who can list deployments. Whatever assembles the App Service setting substitutes the password from the same secret this module was given, and must keep `sslmode=require` — see the TLS note at the top of this file.')
output prismaConnectionStringShape string = 'postgresql://${administratorLogin}:<password>@${postgres.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'

@description('The server\'s resource id, for an orchestrator wiring diagnostic settings, private endpoints or role assignments to it.')
output resourceId string = postgres.id

@description('The server\'s name, so a consumer that needs it does not have to parse it back out of the hostname.')
output serverName string = postgres.name
