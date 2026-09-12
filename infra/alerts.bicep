/*
  The application's own alert rules — the ones docs/observability.md argues for that can be
  expressed against App Service METRICS, which need no Log Analytics workspace.

  ---------------------------------------------------------------------------------------------
  Provenance, stated because the last template that drifted from the live estate would have
  taken the site down (12 Sep 2026 audit, C3)

  Both rules below were first created with the Azure CLI on 12 Sep 2026 (audit H3) against the
  existing action group `axiomate-scheduled-pass-operators`, which already carried the
  operator's address. This file mirrors them so a template apply produces the same two rules
  rather than none; it was written from the CLI parameters, not applied first.

  ---------------------------------------------------------------------------------------------
  What is NOT here, and why

  observability.md's rules 2 (the pass has not returned 200 in 26 hours), 4 (intake silence or a
  401) and the "database: not configured" tripwire are log queries: they need the Log Analytics
  workspace that `observability.bicep` creates, and that module has never been deployed — the
  resource group holds no workspace and no Application Insights component. They are owed with
  it, and they belong beside it when it lands.
*/

@description('Resource id of the App Service (the production site, not a slot).')
param siteId string

@description('Resource id of the action group that carries the operators. The scheduled-pass module creates one; reuse it rather than minting a second list of the same people.')
param actionGroupId string

@description('Tags applied to both rules.')
param tags object = {}

/*
  Rule 1 — an instance failing its health check.

  `HealthCheckStatus` is the platform's own reading of GET /api/health, which answers unhealthy
  when the database is unreachable. Five minutes at one-minute evaluation: the platform needs a
  run of failed pings before the metric moves at all (observability.md explains the lag and
  WEBSITE_HEALTHCHECK_MAXPINGFAILURES), so a shorter window would not fire sooner, and a longer
  one would only delay the person who has to act.
*/
resource unhealthy 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'axiomate-tms-unhealthy'
  location: 'global'
  tags: tags
  properties: {
    description: 'An instance of axiomate-tms is failing its health check (/api/health), usually because the database is unreachable. docs/observability.md rule 1.'
    severity: 1
    enabled: true
    scopes: [siteId]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'HealthCheckStatus'
          metricNamespace: 'Microsoft.Web/sites'
          metricName: 'HealthCheckStatus'
          operator: 'LessThan'
          threshold: 100
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [{ actionGroupId: actionGroupId }]
  }
}

/*
  Rule 3 — 5xx responses.

  observability.md asks for "above one per cent of POST /api/workspace over fifteen minutes",
  which is a log query. The metric form here is coarser — any 5xx on the site, more than five in
  fifteen minutes — and is deliberately low, because every 5xx on the write endpoint is a change
  somebody made that did not save, and four in a row halts that browser's queue.
*/
resource serverErrors 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'axiomate-tms-5xx'
  location: 'global'
  tags: tags
  properties: {
    description: 'More than five 5xx responses in fifteen minutes. Every one on POST /api/workspace is a change somebody made that did not save. docs/observability.md rule 3.'
    severity: 2
    enabled: true
    scopes: [siteId]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'Http5xx'
          metricNamespace: 'Microsoft.Web/sites'
          metricName: 'Http5xx'
          operator: 'GreaterThan'
          threshold: 5
          timeAggregation: 'Total'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [{ actionGroupId: actionGroupId }]
  }
}

output unhealthyAlertId string = unhealthy.id
output serverErrorsAlertId string = serverErrors.id
