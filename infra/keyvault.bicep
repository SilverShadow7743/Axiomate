/*
  The vault that holds Axiomate's secrets.

  ---------------------------------------------------------------------------
  What is in here, and what deliberately is not

  Six values, and only six. A value earns a place in this vault if knowing it lets somebody do
  something they could not otherwise do: connect to the database, sign a session cookie, post
  into intake, trigger the scheduled pass, exchange an Entra authorisation code, or spend the
  firm's money at Anthropic.

  Everything else Axiomate reads from the environment is configuration and belongs in the app's
  own settings, in plain sight, in `app.bicep`. The tenant slug appears in browser storage keys.
  The operator's display name is rendered on screen and written into the audit trail. The Entra
  tenant id, client id and redirect URI are sent to every browser that starts a sign-in — they
  are published, not protected. Putting any of those here would cost a lookup on every cold
  start, an RBAC grant, and a rotation story, and would buy nothing.

  The rejected alternative was "put the whole environment in the vault, it is tidier". It is not
  tidier, it is worse: a vault whose contents are mostly harmless teaches the people who read it
  that its contents are harmless, and the day somebody copies a value out into a ticket it will
  be one of the six that matter. `docs/secrets.md` states the line and defends it in prose; this
  file is the half of that decision that Azure enforces.

  ---------------------------------------------------------------------------
  No secret values pass through this template

  This module declares the vault, the grant and the secret *names*. It creates no
  `Microsoft.KeyVault/vaults/secrets` resources and takes no `@secure()` parameters. Values are
  written once, out of band, by a person holding Key Vault Secrets Officer — `docs/secrets.md`
  has the commands.

  The alternative — `@secure()` parameters, with the values supplied by the pipeline — was
  considered and rejected on four counts.

    1. It does not remove the secret, it copies it. The value has to live somewhere before the
       deployment can pass it: a GitHub secret, a pipeline variable, a `.bicepparam` file. That
       copy has its own access list and its own rotation story, and now there are two.
    2. Rotation would become a redeploy, and worse, a redeploy would become a rotation. An
       operator who rotates a leaked token in the portal at nine in the morning would have it
       silently reverted by the next `main.bicep` deployment, which still carries the old
       parameter. A template that owns secret values fights the operator who is holding the
       incident.
    3. Three of the six are not the firm's to choose. Anthropic issues the API key, Entra issues
       the client secret, and the Postgres module owns the database credential. A template can
       only carry those if a human first pastes them into a pipeline, which is the thing being
       avoided.
    4. `what-if` stays honest. With no values in the template, a redeploy reports no change to
       the vault's contents, so a diff that *does* mention a secret is a real signal.

  The cost, stated because it is not free: a freshly deployed environment comes up with an empty
  vault, and stays that way until somebody fills it in. Axiomate degrades rather than failing —
  intake refuses, the assistant answers offline, the workspace runs from the seed file — so this
  is survivable, but it is not "deployed and working", and `docs/secrets.md` says so plainly.

  What is emphatically NOT done here is seeding the vault with placeholder values so the
  references resolve. A placeholder is not an absent secret; it is a present, wrong one, and the
  application would happily sign session cookies with the word "changeme".
*/

targetScope = 'resourceGroup'

@description('Vault name. Globally unique across Azure, 3-24 characters, letters, digits and hyphens, starting with a letter. Owned by main.bicep: a name derived inside this module would change when the resource group did, and a Key Vault that changes name is a new vault plus a tombstone.')
@minLength(3)
@maxLength(24)
param name string

@description('Where the vault lives. Same region as the app, so a secret lookup is not a trip across the country on every cold start.')
param location string = resourceGroup().location

@description('Tags applied to the vault. Inherited from main.bicep rather than invented here.')
param tags object = {}

/*
  Required, and required to look like an object id.

  The tempting alternative is to accept an empty string and skip the grant, so the vault can be
  deployed before the web app exists. That trades a deployment-time error for a runtime mystery:
  an app whose every secret lookup returns 403, hours later, with nothing in the template to
  suggest why. If the ordering is wrong, main.bicep should fail to compile a plan, loudly, here.
*/
@description('Object id of the principal that reads these secrets — the web app\'s managed identity, produced by app.bicep. Note this is the identity\'s *principal* (object) id, not its client id or its resource id.')
@minLength(36)
@maxLength(36)
param appIdentityPrincipalId string

/*
  Ninety days is the maximum, and the maximum is the point: soft delete is only useful for as
  long as it takes somebody to notice. The dial exists because a throwaway environment pays a
  real cost for it — see the purge-protection note below — and seven days is a defensible answer
  there. It is not a defensible answer in production.

  Set once, at creation. Retention can be raised on an existing vault but not lowered, so this is
  a decision taken before the first deployment rather than tuned afterwards. Combined with purge
  protection, choosing ninety here is choosing ninety days of an occupied vault name if the
  deployment turns out to be a mistake.
*/
@description('How long a deleted vault, and the secrets in it, remain recoverable. 7 to 90 days, and cannot be lowered once the vault exists.')
@minValue(7)
@maxValue(90)
param softDeleteRetentionInDays int = 90

/*
  Open by default, and that is a considered position rather than a default nobody looked at.

  This vault is guarded by Entra tokens and RBAC, not by network position; an attacker on the
  public endpoint without a role assignment gets 403 exactly as they would from inside a subnet.
  The rejected alternative — `defaultAction: 'Deny'` — is stronger, and it is also the thing that
  silently breaks Key Vault references the moment the web app is not integrated with the right
  virtual network, which this module cannot see from here. Turning it on is a decision for the
  firm, taken together with a decision about a private endpoint, and it must be taken with the
  app's networking in view rather than by flipping this flag alone.
*/
@description('Whether the vault answers on its public endpoint. Setting this false also requires the web app to reach the vault over a virtual network, which this module cannot arrange.')
param allowPublicNetworkAccess bool = true

/*
  Optional, because the workspace belongs to main.bicep and may not exist yet. Worth wiring the
  moment it does: without it there is no answer to "who read this secret, and when", which is the
  first question asked after a token turns up somewhere it should not be. The vault records
  reads; nothing else in this system does.
*/
@description('Resource id of a Log Analytics workspace to send vault audit events to. Empty means vault reads are not recorded anywhere.')
param logAnalyticsWorkspaceId string = ''

/* ================================================================== *
 * The secrets this application reads
 * ================================================================== */

/*
  The mapping from environment variable to vault secret name, in one place because it is the
  contract between this module, `app.bicep` and the person holding `docs/secrets.md`.

  The names are not the variable names, and cannot be: Key Vault secret names accept only letters,
  digits and hyphens, so `AXIOMATE_SESSION_SECRET` is not a legal name. Hence the mapping is
  published as an output rather than left for each caller to guess at.

  Every name is prefixed, including the Anthropic key which is not Axiomate's own. A vault that
  is later shared with a second workload should not have to be renamed to stay legible.

  Exported as well as output. The output is for a caller that has deployed this module and can
  wait on it; the export is for one that cannot. `main.bicep` builds the app's Key Vault
  references before this module is deployed — that is how the app-and-vault ordering cycle is
  broken — so it needs the mapping at compile time, from the file, rather than at deployment
  time, from the module. An import creates no dependency edge, which is exactly the property
  that makes it usable there; restating the six names in main.bicep instead would put the
  contract in two files and let them drift a rename at a time.
*/
@export()
var secretNames = {
  DATABASE_URL: 'axiomate-database-url'
  AXIOMATE_ENTRA_CLIENT_SECRET: 'axiomate-entra-client-secret'
  AXIOMATE_SESSION_SECRET: 'axiomate-session-secret'
  AXIOMATE_INTAKE_TOKEN: 'axiomate-intake-token'
  AXIOMATE_SCHEDULE_TOKEN: 'axiomate-schedule-token'
  ANTHROPIC_API_KEY: 'axiomate-anthropic-api-key'
}

/* ================================================================== *
 * The vault
 * ================================================================== */

/*
  Pinned to a GA version whose types every Bicep CLI in circulation already carries. Newer ones
  exist; the only property this module would gain from one is `enableRbacAuthorization` defaulting
  to true, which is set explicitly below regardless — a default that changed under the firm's feet
  is not a thing this template should depend on either way.
*/
resource vault 'Microsoft.KeyVault/vaults@2024-11-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    /*
      Standard rather than premium. Premium buys HSM-backed *keys*, and this vault holds no keys —
      six secrets and nothing else. Paying for a hardware module to protect a bearer token that is
      sent over the wire in an Authorization header would be security theatre with an invoice.
    */
    sku: {
      family: 'A'
      name: 'standard'
    }

    /*
      The directory that authenticates callers *to this vault*: Axiocloud's own, taken from the
      subscription rather than passed in, because a vault in a subscription belonging to one
      directory cannot be authenticated by another.

      Three different things in this system are called a tenant and only one of them is this.
      `AXIOMATE_TENANT` is the application's own tenancy slug — the delivery firm the workspace
      belongs to — and lives in app settings. `AXIOMATE_ENTRA_TENANT_ID` is the directory the
      firm's *people* sign in from, which is usually this one and is not required to be. This
      value governs neither; it governs who may open the vault.
    */
    tenantId: subscription().tenantId

    /*
      Azure RBAC, not access policies.

      Access policies are a second, parallel authorisation system that only Key Vault has:
      permissions that do not appear in the subscription's role assignments, are not visible to
      `az role assignment list`, are not covered by Azure Policy or access reviews, and do not
      appear in any report of who can reach what. They also have a sixteen-entry practical limit
      and no inheritance, so they are copied by hand and drift.

      RBAC puts the answer to "who can read this secret" in the same place as the answer for
      every other resource the firm owns, which is the only place anybody will think to look in a
      year. The cost is real and worth naming: role assignments take a minute or two to propagate,
      so a deployment that creates an identity and immediately reads a secret can fail once and
      succeed on retry. That is a worse first five minutes and a better next five years.
    */
    enableRbacAuthorization: true

    /*
      Soft delete and purge protection, and the trade-off in full.

      Soft delete means a deleted vault, and any deleted secret in it, can be recovered for
      `softDeleteRetentionInDays`. Purge protection means that during that window nobody — not an
      owner, not a compromised service principal, not the person who wrote this file — can
      hard-delete it early. Only the Key Vault service itself may, once the window expires.

      What that costs, stated plainly because it is irreversible:

        - Purge protection cannot be turned off. The ARM property does not accept `false` on a
          vault that has it, so a template that tries to set it back will fail the deployment,
          not quietly revert. That is why it is hardcoded here rather than parameterised: a
          parameter would advertise a choice that does not exist and would hand somebody a
          `false` that breaks their next deployment.
        - A vault created in error is stuck. It cannot be removed for the full retention period,
          and because vault names are globally unique across Azure, its *name* is stuck with it.
          Deploying `kv-axiomate-prod` by mistake means not having that name back for ninety days.
          Get the name right the first time, and use a distinct name per environment.

      It is bought anyway, because the failure it prevents is unbounded. An attacker who reaches a
      subscription owner can delete a vault; without purge protection they can then purge it, and
      the firm's database credential, session key and intake token are gone rather than merely
      rotated — along with the audit trail of what they took. Ninety days of an occupied name is
      the cheaper problem by a wide margin.
    */
    enableSoftDelete: true
    enablePurgeProtection: true
    softDeleteRetentionInDays: softDeleteRetentionInDays

    /*
      Off, all three, and each for the same reason: nothing in this deployment needs them, and a
      capability that is on but unused is a capability nobody notices being used.

      `enabledForTemplateDeployment` is the important one. It permits an ARM deployment to read
      secrets *out* of this vault and into a template's parameters — which is precisely the
      pattern this module was written to avoid, and leaving it off means a future template cannot
      quietly adopt it.
    */
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: false

    publicNetworkAccess: allowPublicNetworkAccess ? 'Enabled' : 'Disabled'
    networkAcls: {
      /*
        `bypass: AzureServices` admits the platform services that are on Key Vault's trusted list.
        It does *not* admit App Service: a Key Vault reference is resolved from the app's ordinary
        outbound address, which is why Microsoft's own guidance is that a vault must not be
        configured around an app's public outbound IPs. Closing this vault therefore means giving
        the web app virtual network integration, or a private endpoint, or both — which is the
        substance of the decision above and the reason this flag is not the whole of it.

        Set in both cases so that closing the vault later is one change rather than two. It grants
        nothing on its own while the default action is Allow.
      */
      bypass: 'AzureServices'
      defaultAction: allowPublicNetworkAccess ? 'Allow' : 'Deny'
    }
  }
}

/* ================================================================== *
 * Who may read
 * ================================================================== */

/*
  Key Vault Secrets User: get and list secret *values*, and nothing else.

  Written as the role's GUID rather than its display name because role definition ids are the
  stable identifier and display names are not — and because `subscriptionResourceId` needs the id
  regardless. Named in a variable so the reader can check it against the built-in roles list
  without decoding a nested expression.

  Deliberately not Key Vault Secrets Officer, which can also *write* and *delete* secrets. The web
  app never writes a secret; granting it the ability would mean a compromised app could rotate the
  firm's intake token out from under the connector, and could delete the session key and sign
  everybody out. Reading is the whole job.
*/
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource secretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  /*
    A deterministic name, derived from the three facts that define the assignment. Role assignment
    names must be GUIDs and must be unique within scope; deriving one means a redeploy updates the
    same assignment instead of failing on a duplicate or leaving a second one behind.
  */
  name: guid(vault.id, appIdentityPrincipalId, keyVaultSecretsUserRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: appIdentityPrincipalId
    /*
      Stated rather than inferred. Without it ARM looks the principal up in the directory to work
      out what it is, and a managed identity created moments earlier in the same deployment may
      not have replicated yet — which surfaces as "principal does not exist", on a first
      deployment, roughly half the time.
    */
    principalType: 'ServicePrincipal'
  }
}

/* ================================================================== *
 * The record of who read what
 * ================================================================== */

/*
  A preview API version, unlike the vault above, and not by oversight: this is the newest version
  Microsoft publishes for this type, and `categoryGroup` — which is what asks for "the audit
  categories, whatever they turn out to be" rather than naming `AuditEvent` and going stale — does
  not exist in the older stable ones. The alternative is a GA version that requires the category
  list to be maintained by hand here.
*/
resource auditToWorkspace 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = if (!empty(logAnalyticsWorkspaceId)) {
  scope: vault
  name: 'audit'
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    /*
      The audit category group, which carries AuditEvent: every authenticated data-plane
      operation, including each secret read, with the identity that made it. Metrics are not
      collected — a count of requests answers no question worth asking about a vault holding six
      values, and paying to ingest it would be paying for noise.
    */
    logs: [
      {
        categoryGroup: 'audit'
        enabled: true
      }
    ]
  }
}

/* ================================================================== *
 * What the rest of the deployment needs from this
 * ================================================================== */

@description('The vault\'s name. Needed to build a Key Vault reference, and to run the az commands in docs/secrets.md.')
output vaultName string = vault.name

@description('The vault\'s resource id. For scoping further role assignments — an operator group holding Key Vault Secrets Officer, for instance, which is a decision for the firm and not for this template.')
output vaultResourceId string = vault.id

@description('The vault\'s data-plane URI, for a client that reads secrets directly rather than through app settings.')
output vaultUri string = vault.properties.vaultUri

@description('Environment variable name to vault secret name. The mapping exists because Key Vault names cannot contain underscores; app.bicep should read it rather than restate it.')
output secretNames object = secretNames

/*
  Ready-made App Service and Functions reference strings, as a convenience for `app.bicep`.

  No version is pinned in these. Pinning one means a rotated secret is ignored until somebody
  redeploys, which turns every rotation into a code change and is how an emergency rotation gets
  half done. Unpinned, the platform picks up a new version on its own — within 24 hours, which is
  its cache lifetime and not a number anybody should discover during an incident. `docs/secrets.md`
  gives the command that forces it sooner.

  These are inert if the app turns out to be a Container App rather than an App Service; that
  runtime resolves vault secrets through its own `keyVaultUrl` on a secret entry, for which
  `vaultUri` and `secretNames` above are what is needed.
*/
@description('Environment variable name to a Key Vault reference string, for use as an App Service app setting value.')
output secretReferences object = {
  DATABASE_URL: secretReference(vault.name, secretNames.DATABASE_URL)
  AXIOMATE_ENTRA_CLIENT_SECRET: secretReference(vault.name, secretNames.AXIOMATE_ENTRA_CLIENT_SECRET)
  AXIOMATE_SESSION_SECRET: secretReference(vault.name, secretNames.AXIOMATE_SESSION_SECRET)
  AXIOMATE_INTAKE_TOKEN: secretReference(vault.name, secretNames.AXIOMATE_INTAKE_TOKEN)
  AXIOMATE_SCHEDULE_TOKEN: secretReference(vault.name, secretNames.AXIOMATE_SCHEDULE_TOKEN)
  ANTHROPIC_API_KEY: secretReference(vault.name, secretNames.ANTHROPIC_API_KEY)
}

/*
  The reference format itself, factored out of the output above and exported for the same reason
  the mapping is.

  It reads as a needless wrapper around one interpolation, and it is not: it is the only place in
  the repository that spells `@Microsoft.KeyVault(...)`. `main.bicep` has to build these strings
  without waiting for this module to deploy, so without this function the format would be typed
  out a second time there, and the two copies would agree right up until somebody moved to the
  `SecretUri=` form and changed only one of them. A caller that already holds the vault takes the
  output; a caller that is still deciding what to deploy takes the function.

  `VaultName=` rather than `SecretUri=` deliberately: the URI form pins the vault's DNS name and,
  if a version is appended, the version with it, and it requires the vault to exist before the
  string can be written. The name is enough for App Service to resolve against, and the name is
  the one thing about this vault that main.bicep knows before anything is deployed.
*/
@export()
func secretReference(vaultName string, secretName string) string =>
  '@Microsoft.KeyVault(VaultName=${vaultName};SecretName=${secretName})'
