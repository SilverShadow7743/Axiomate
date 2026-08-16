// Axiomate — deployment values for the Postgres module.
//
// This file exists so `postgres.bicep` can be deployed and reviewed on its own:
//
//   az deployment group create -g <resource-group> -f infra/postgres.bicep -p infra/postgres.bicepparam
//
// When `infra/main.bicep` composes the estate it will pass these same values as module inputs
// instead, taking the subnet and DNS zone from the network module rather than from an operator's
// shell. That is the normal path; this file is the one for deploying the database by itself,
// which is what happens the first time and whenever the database is changed alone.
//
// ---------------------------------------------------------------------------
// Five values are read from the environment rather than written here
//
//   AXIOMATE_PG_ADMIN_PASSWORD    the administrator password
//   AXIOMATE_PG_ENTRA_ADMIN_ID    object id of the Entra group that administers the server
//   AXIOMATE_PG_ENTRA_ADMIN_NAME  that group's display name
//   AXIOMATE_PG_SUBNET_ID         resource id of the delegated subnet
//   AXIOMATE_PG_DNS_ZONE_ID       resource id of the private DNS zone
//
// Only the first is a secret. The other four are absent for a different reason: they are
// subscription-specific identifiers that nobody can write down correctly without the
// subscription in front of them, and a plausible-looking GUID committed to a repository is worse
// than a missing one, because it deploys.
//
// `readEnvironmentVariable` is called with one argument on purpose. Given a second it would
// supply a default when the variable is unset, which would turn a missing password into a silent
// fallback — the same failure `currentTenantId()` in `lib/tenant.ts` refuses to make, and for the
// same reason. Unset means the build fails, loudly, before anything is deployed.
//
// The alternative for the password is `az.getSecret(...)`, which reads it straight from a key
// vault at deployment time and never puts it in a shell at all. That is the better answer and is
// where this should end up. It is not used here because it hard-codes a subscription id, a
// resource group and a vault name — values that exist in a deployed environment rather than in a
// repository, and that would make this file specific to one subscription — and because the
// deploying principal needs a role assignment on that vault first. An environment variable is the
// honest interim: the secret is still not in the file, and the upgrade is one line.

using './postgres.bicep'

// Globally unique, because it becomes a public DNS name. `psql-` is the Azure abbreviation for a
// PostgreSQL flexible server; `axiomate` is the workload and `prod` the environment, so a second
// environment is a second file with `dev` here rather than an edit to this one.
param name = 'psql-axiomate-prod'

// UK South. The firm is British — statements of work in this schema default to GBP — so the data
// stays in the United Kingdom, and the App Service that reads it belongs in the same region.
param location = 'uksouth'

param tags = {
  application: 'axiomate'
  environment: 'production'
  tenant: 'axiocloud'
  managedBy: 'bicep'
}

// The module's defaults are already the right answers for a firm this size: Postgres 18 on a
// Standard_B1ms Burstable with 32 GiB of storage, fourteen days of backups, no geo-redundancy,
// and a database called `axiomate`. They are restated here rather than inherited silently,
// because a parameters file that says nothing about compute makes the bill somebody's discovery
// rather than somebody's decision.
param postgresVersion = '18'
param skuTier = 'Burstable'
param skuName = 'Standard_B1ms'
param storageSizeGB = 32
param backupRetentionDays = 14
param geoRedundantBackup = false
param databaseName = 'axiomate'

// Letters and digits only: the service rejects an underscore in this name, and it is fixed for
// the life of the server.
param administratorLogin = 'axiomateadmin'
param administratorLoginPassword = readEnvironmentVariable('AXIOMATE_PG_ADMIN_PASSWORD')

// A group, not a person. The firm's database administrators are whoever is in it today, and
// removing somebody from the group is the whole revocation — there is no second place to
// remember to look.
param entraAdministratorObjectId = readEnvironmentVariable('AXIOMATE_PG_ENTRA_ADMIN_ID')
param entraAdministratorPrincipalName = readEnvironmentVariable('AXIOMATE_PG_ENTRA_ADMIN_NAME')
param entraAdministratorPrincipalType = 'Group'

// Private, which is the module's default and is restated because it is the one choice on this
// page that cannot be changed afterwards. The two identifiers below are its preconditions: the
// subnet must be delegated to Microsoft.DBforPostgreSQL/flexibleServers and hold nothing else,
// and the zone must be named privatelink.postgres.database.azure.com and be linked to the same
// virtual network. Deploying with either of them wrong produces a server that exists and that
// nothing can resolve.
param networkAccess = 'Private'
param delegatedSubnetResourceId = readEnvironmentVariable('AXIOMATE_PG_SUBNET_ID')
param privateDnsZoneResourceId = readEnvironmentVariable('AXIOMATE_PG_DNS_ZONE_ID')

// Both are ignored while `networkAccess` is Private — a virtual-network-integrated server has no
// firewall to write rules into. They are set to their narrowest values anyway, so that switching
// this file to PublicWithFirewall opens nothing by accident: it would then be an explicit edit to
// name the office address that may reach the database.
param allowAzureServices = false
param clientIpAddress = ''
