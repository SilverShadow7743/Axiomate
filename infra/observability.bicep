/*
  Where this application's operational telemetry goes.

  ---------------------------------------------------------------------------
  Two resources, because Application Insights is no longer a store

  A workspace-based Application Insights component is a front end: the telemetry it accepts is
  written into a Log Analytics workspace, and it is the workspace that owns retention, access
  and the bill. Deploying the component alone is not an option any more — `WorkspaceResourceId`
  is required on this API version — and treating the pair as one module is the honest shape,
  because a retention parameter on the component would be setting a property that the workspace
  overrules.

  ---------------------------------------------------------------------------
  What this module deliberately does not do

  It does not configure the App Service, and it does not create alert rules. The App Service and
  its settings belong to another module — this one hands over a connection string and stops —
  and alert rules are declared where the thresholds are argued for, which is
  `docs/observability.md`. Splitting them means a change of threshold is not a change to the
  resource that stores the data.
*/

@description('Prefix for the resource names. The workspace and the component are named from it so that the pair is obviously one deployment.')
@minLength(3)
@maxLength(24)
param namePrefix string

@description('Where the telemetry lives. Worth keeping equal to the App Service region: cross-region ingestion is charged as egress and adds latency to every send.')
param location string = resourceGroup().location

@description('Applied to both resources. Cost reporting cannot separate observability from the rest of the estate without them.')
param tags object = {}

/*
  Retention, and what it costs.

  Ingestion and retention are billed separately, and confusing them is how retention gets blamed
  for a bill it did not cause. Ingestion is a per-gigabyte charge paid once, when the telemetry
  arrives. Retention is a per-gigabyte-per-month charge on everything still being held, applied
  daily. So the retention line is roughly volume x days and the ingestion line is volume alone:
  halving retention halves the smaller of the two numbers and changes the larger one not at all.
  The lever that moves the bill is what the application sends, not how long it is kept.

  The included allowance is not one number, and the difference decides what this default costs.
  Every gigabyte ingested includes 31 days of analytics retention at no extra retention charge,
  and Application Insights data includes 90. The workspace will hold both kinds: request and
  trace telemetry from the Application Insights component, which gets the 90, and the App
  Service platform tables — `AppServiceHTTPLogs`, `AppServiceConsoleLogs` — which get 31.

  So a default of 90 is free for one half and billed for the other. Days 32 to 90 of the App
  Service platform tables are charged per gigabyte per month, and those are the tables most of
  the queries in `docs/observability.md` actually run against. This default buys something; it is
  not a free lunch, and anyone reading the bill should expect a retention line rather than be
  surprised by one.

  It is still the right default. Dropping to 31 would save only on the platform tables while
  cutting Application Insights history from 90 days to 31 — discarding two months of data that
  cost nothing to keep, in order to save a fraction of the smaller line. The operational argument
  points the same way: the scheduled pass runs once a day, so a fault in it may take a fortnight
  to notice and a month of history to characterise, which 90 days covers comfortably and 31 does
  not.

  If the platform tables turn out to dominate the bill, the instrument is table-level retention
  rather than this parameter — leave the workspace default at 90 and cap the noisy tables at 31
  individually, which keeps the free Application Insights history and stops paying for the rest.
  Above 90 the parameter costs money linearly on everything. Beyond a year it is a compliance
  argument rather than an operational one, and compliance evidence about business change is the
  audit trail in Postgres, not this.
*/
@description('Days of analytics retention. Application Insights data includes 90 at no retention charge; App Service platform log tables include only 31, so days 32-90 of those are billed per GB per month.')
@minValue(30)
@maxValue(730)
param retentionInDays int = 90

/*
  The daily cap, and why it defaults to off.

  A cap is the only hard stop on an unbounded bill: a retry loop or a logging regression can
  multiply ingestion overnight, and nothing else in this module notices. But a cap does not slow
  ingestion down, it discards everything after the limit for the rest of the day — so it converts
  a cost incident into an observability blackout, and it does so at exactly the moment something
  is going wrong enough to produce that much telemetry.

  Left off by default because that is the choice that cannot silently lose the evidence for an
  outage. A deployment that would rather be blind than surprised sets a number here, and should
  set it well above a normal day's volume so that it is a fuse rather than a budget.
*/
@description('Hard daily ingestion cap in GB. -1 means uncapped. A cap drops all telemetry for the remainder of the day once reached.')
param dailyQuotaGb int = -1

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-logs'
  location: location
  tags: tags
  properties: {
    // PerGB2018 is pay-as-you-go. A commitment tier is cheaper per gigabyte and is worth moving
    // to once daily volume is known and steady; committing before there is a baseline buys
    // capacity for a workload nobody has measured.
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
    workspaceCapping: {
      dailyQuotaGb: dailyQuotaGb
    }
    features: {
      /*
        Only the workspace's own resource permissions decide who can read this data.

        The alternative lets anyone with reader on a monitored resource read that resource's
        telemetry. It is convenient and it is wrong here: this is a multi-tenant delivery firm's
        estate, and telemetry that names endpoints, timings and failure rates should be readable
        by the people who operate the platform, not by everybody who can see a resource in the
        portal.
      */
      enableLogAccessUsingOnlyResourcePermissions: false
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${namePrefix}-insights'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    // Says the telemetry is written through to the workspace rather than to the component's own
    // legacy store. Anything else would put the data somewhere this module's retention parameter
    // does not reach, which is the failure mode the whole two-resource shape exists to avoid.
    IngestionMode: 'LogAnalytics'
    /*
      Retention is set on the workspace and not repeated here.

      The component exposes a `RetentionInDays` of its own, and setting it on a workspace-based
      resource creates two properties that answer the same question and will eventually disagree.
      The workspace is the one that governs, so the workspace is the only one that is written.
    */
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

@description('The Log Analytics workspace. Alert rules and diagnostic settings are scoped to this.')
output workspaceId string = workspace.id

@description('The Application Insights component, for modules that need to scope an alert or a diagnostic setting to it rather than send telemetry to it.')
output appInsightsId string = appInsights.id

/*
  The connection string, which is what the App Service module puts in
  APPLICATIONINSIGHTS_CONNECTION_STRING.

  Emitting the resource id alone and having the consumer resolve the string itself was the
  alternative, and it is the tidier one: deployment outputs are recorded in the resource group's
  deployment history, readable by anyone with reader on the group, so nothing sensitive should
  travel this way. It is not taken because it pushes an existing-resource reference into every
  consuming module for no gain in secrecy — the string is an ingestion key, it authorises writing
  telemetry and grants no access to read any, and it is going straight into an app setting that
  the same people can already read.

  What it does authorise is worth naming: anyone holding it can send telemetry into this
  workspace, which means polluting the signals below and spending the ingestion budget. Treat it
  as a write credential with a cost attached, not as a public identifier.
*/
@description('Application Insights connection string, for the App Service module to set as APPLICATIONINSIGHTS_CONNECTION_STRING.')
output connectionString string = appInsights.properties.ConnectionString
