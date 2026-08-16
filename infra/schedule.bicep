/*
  The thing that calls the scheduled pass once a day.

  ---------------------------------------------------------------------------
  Why a Logic App rather than a Function App with a timer trigger

  A timer-triggered Function was the obvious alternative and it loses on three counts.

  The first is decisive: a Function is code, and code has to be deployed. This template can
  provision a Function App, a storage account and a runtime, and every one of those resources
  would come up healthy while nothing whatsoever called the endpoint — a scheduler that appears
  to exist and does not run is the exact failure this file is meant to prevent. The Logic App
  carries its own behaviour in its resource definition, so deploying it is the whole of shipping
  it.

  The second is what an operator sees at seven in the morning when it breaks. A Consumption
  Logic App keeps run history on the resource itself: each day is a row, and opening one shows
  the HTTP action's status code and response body. The body is the pass's own summary — "3 new ·
  12 continuing · 1 cleared · 4 messages raised" — so the question "did it run, and what did it
  decide" is answered in one blade by somebody who has never seen this codebase. The equivalent
  for a Function is an Application Insights instance and a Kusto query.

  The third is the standing cost of the extra resources. At one execution a day neither option
  costs anything worth discussing — two built-in operations a day here, and a Function's compute
  sitting inside the Consumption free grant. But a Function App obliges somebody to own a
  storage account and a language runtime version for as long as the firm exists, and a Node
  runtime that goes end-of-support is a scheduler that stops on a date nobody diarised.

  ---------------------------------------------------------------------------
  What this file deliberately does not do

  It does not create the token, and it does not read Key Vault. `scheduleToken` is a `@secure()`
  parameter because a Bicep module cannot resolve a Key Vault reference on its own parameters —
  only the deployment that calls a module can, via `getSecret()`. So the caller in `main.bicep`
  is expected to write something of this shape, which keeps the secret out of this template, out
  of the compiled ARM, and out of the deployment history:

      module schedule 'schedule.bicep' = {
        name: 'schedule'
        params: {
          appHostName: app.outputs.defaultHostName
          scheduleToken: vault.getSecret('axiomate-schedule-token')
        }
      }

  It also does not offer its own on/off switch. The pass already has one, on the Scheduled pass
  configuration screen, and that one is better: turning it off there returns the previous
  observation untouched, so switching it back on later does not announce a month of accumulated
  conditions in one go. A second switch in the infrastructure would look equivalent and would
  not be. To stop the calls entirely — during a maintenance window, say — disable the Logic App
  in the portal, which also stops the failure alert below from firing at nobody.
*/

@description('Where the resources live. The Logic App is not latency-sensitive; put it wherever the rest of the deployment is.')
param location string = resourceGroup().location

@description('The application\'s host name, without scheme or path — for example axiomate.azurewebsites.net.')
param appHostName string

@description('The shared secret the endpoint requires, the same value as AXIOMATE_SCHEDULE_TOKEN. Supply it from Key Vault via getSecret() in the calling template; never as a literal.')
@secure()
param scheduleToken string

/*
  The hour, in the firm's own time.

  Seven in the morning, for three reasons that are worth stating because somebody will want to
  move it.

  It is before the working day. The pass turns yesterday's dates into notices, and the point of
  a notice is that it is waiting when the person arrives rather than landing while they are
  already working on something else. A delivery firm starts its day by looking at what slipped
  overnight, and this is what fills that list.

  It is before anyone is editing. Each run takes a Serializable transaction across the whole
  workspace, held for up to thirty seconds. At seven there is nothing to contend with. At eleven
  it would compete with live edits, and a serialisation conflict would surface as a failed run
  for a reason that has nothing to do with the schedule.

  It is far enough from midnight that the date is unambiguous — see the note on the time zone
  below, which is the part that actually constrains the lower bound.
*/
@description('Hour of the day, in scheduleTimeZone, at which the pass runs. Default 07.')
@minValue(1)
@maxValue(23)
param scheduleHour int = 7

@description('Minute of the hour. Azure may vary the actual moment by up to a minute; nothing downstream depends on the exact second.')
@minValue(0)
@maxValue(59)
param scheduleMinute int = 0

/*
  The time zone, and the reason the hour above cannot start at zero.

  Azure schedulers are UTC unless told otherwise, and the firm is not: it keeps GMT in winter
  and BST in summer. Naming a Windows time zone here — rather than computing a UTC offset once
  and hard-coding it — is what makes the trigger shift itself in March and October. Azure's own
  guidance is explicit that a recurrence honours daylight saving only when a time zone is set.

  That leaves one seam, and it is in the application rather than here. `runScheduledPass` takes
  its notion of "today" from `new Date().toISOString()`, which is the UTC date whatever the
  server's own clock is set to. At 07:00 the two agree: 07:00 GMT is 07:00 UTC, and 07:00 BST is
  06:00 UTC, both on the same calendar day. They stop agreeing between midnight and one in the
  morning during BST, where the local date has rolled over and the UTC date has not: 00:30 BST is
  23:30 UTC on the day before. The pass would then read the workspace as of yesterday, and go on
  doing so every night — permanently a day behind the firm it reports to. Hence `@minValue(1)`.

  The bound is correct for this zone and any zone east of UTC. A zone west of UTC has the same
  hazard at the other end of the day, and no numeric bound expresses both — so the rule is
  written down in docs/scheduled-pass.md rather than pretended away here.
*/
@description('Windows time zone id for the schedule. "GMT Standard Time" is the United Kingdom, and observes BST.')
param scheduleTimeZone string = 'GMT Standard Time'

/*
  Why a start time is set at all, given it is in the past.

  Without one, a Consumption workflow's recurrence fires the moment the template is deployed,
  whatever the schedule says. That is precisely the wrong moment: the first run against a
  workspace with history raises every condition at once, and an operator who has not yet seeded
  the memory by running it by hand gets that flood as a side effect of a deployment. With a start
  time and an explicit hour, the trigger fires no sooner than the start time and then only at the
  scheduled hour, so the first automated run lands tomorrow morning rather than at deployment.

  The default is in the past, which is enough for a deployment onto a pass that is already
  running. Set it to a future date whenever the pass has not yet been run by hand against real
  data: a start time ahead of now is the documented way to say when the first run may happen, and
  it does not depend on reading the past-start-time behaviour correctly.
*/
@description('The trigger fires no sooner than this. ISO 8601, with no trailing Z — a Z would make Azure ignore scheduleTimeZone.')
param firstRunNotBefore string = '2026-01-01T00:00:00'

@description('Where a failed run is emailed. Left empty, the alert still fires and is visible under Azure Monitor, but reaches nobody actively.')
param alertEmail string = ''

@description('Name of the Logic App. It appears in the portal, so name it after what it does.')
param logicAppName string = 'axiomate-scheduled-pass'

@description('Tags applied to everything this file creates.')
param tags object = {}

var endpointUrl = 'https://${appHostName}/api/schedule/run'

resource scheduledPass 'Microsoft.Logic/workflows@2019-05-01' = {
  name: logicAppName
  location: location
  tags: tags
  properties: {
    state: 'Enabled'
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      parameters: {
        /*
          Declared inside the workflow as well as on the template, because the two hide the
          secret from different audiences. The template parameter keeps it out of the compiled
          ARM and the deployment history; a SecureString workflow parameter keeps it out of the
          resource definition that anyone with read access on the Logic App can fetch.
        */
        scheduleToken: {
          type: 'SecureString'
        }
      }
      triggers: {
        Every_morning: {
          type: 'Recurrence'
          recurrence: {
            frequency: 'Day'
            interval: 1
            timeZone: scheduleTimeZone
            startTime: firstRunNotBefore
            /*
              The hour and minute are stated rather than left to drift. A recurrence with no
              schedule computes the next run from the last run, so latency accumulates and a
              seven o'clock job wanders into the working day over a few months.

              Every day, weekends included, and that is deliberate. Skipping Saturday and Sunday
              would not save anybody a message — notifications are records in an inbox, so a
              Saturday notice is still unread on Monday — but it would stop the memory moving
              for two days, which means conditions that cleared over the weekend are not
              forgotten and a Friday-evening breach is not recorded until Monday.
            */
            schedule: {
              hours: [
                scheduleHour
              ]
              minutes: [
                scheduleMinute
              ]
            }
          }
        }
      }
      actions: {
        Run_the_scheduled_pass: {
          type: 'Http'
          inputs: {
            method: 'POST'
            uri: endpointUrl
            headers: {
              /*
                The endpoint takes either this or a signed-in operator holding config.manage.
                A scheduler has no session, so it is this.

                Azure does not show Authorization headers in run history inputs or outputs, so
                the token is not retrievable from a blade that half the firm can open. Marking
                the action's inputs secure as well was considered and rejected: it would hide
                the URL too, and the URL is the first thing an operator checks when the run
                fails against the wrong host.
              */
              Authorization: 'Bearer @{parameters(\'scheduleToken\')}'
            }
            /*
              Retrying is safe, and it is safe for a reason in the application rather than a
              hope about the network.

              The whole run — the messages it raises and its own memory of having raised them —
              commits in one Serializable transaction. So there is no partial state to retry
              into: either the run happened and the memory moved, or neither did. A retry after
              a run that in fact committed finds every condition already recorded in the
              previous observation, counts them as continuing, and raises nothing. A retry after
              a genuine failure is exactly what is wanted.

              Four retries after the original, so five attempts in all.

              Azure retries only 408, 429, 5xx and connection failures. That is the right split
              here: a 401 from a stale token is not retried, so a broken secret fails once,
              immediately, and visibly, instead of being buried under four quiet retries.
            */
            retryPolicy: {
              type: 'exponential'
              count: 4
              interval: 'PT1M'
              minimumInterval: 'PT30S'
              maximumInterval: 'PT5M'
            }
            /*
              Two minutes is the ceiling for an outbound request from a Consumption workflow,
              and it is set explicitly rather than inherited because the sum it has to cover is
              known: up to ten seconds waiting for the transaction slot, up to thirty inside it,
              and — on a plan that scales to zero — a cold start in front of both. Anything
              tighter would report a failure for an application that was merely asleep.
            */
            limit: {
              timeout: 'PT2M'
            }
          }
          runAfter: {}
        }
      }
      outputs: {}
    }
    parameters: {
      scheduleToken: {
        value: scheduleToken
      }
    }
  }
}

/*
  Where a failure goes.

  A scheduler whose failures are invisible is worse than no scheduler, because everybody assumes
  it ran. The Logic App on its own is exactly that: a failed run is a red row on a page nobody
  opens. So the failure is pushed rather than waited for.

  What this covers and what it does not, stated plainly because the gap matters. It fires when a
  run fails — the endpoint returned 500, the token was rejected, the application never answered.
  It cannot fire when a run never started, because a run that does not happen emits no metric to
  threshold against. The detector for that is the application's own record of when it last ran,
  and the operator's page says how to read it.

  Making the run fail when the pass reports rules that reached nobody was considered and
  rejected. A rule addressed to a role nobody holds is a configuration mistake, and turning it
  into a nightly page would train the recipient to ignore the alert that means the pass is down.
  Those come back in the run's response body, where the operator sees them next to everything
  else the run decided.
*/
/*
  The group is created whether or not an address was supplied, and is empty when one was not.

  Conditioning the resource on the parameter was the first attempt and is worse: it makes adding
  an operator later a redeployment rather than a thirty-second edit in the portal, and it leaves
  the alert rule pointing at a group that may or may not exist. An empty group is honest — the
  alert fires, the portal shows it, and nobody is emailed until somebody says who.
*/
resource operators 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: '${logicAppName}-operators'
  location: 'Global'
  tags: tags
  properties: {
    groupShortName: 'AxiomateSch'
    enabled: true
    emailReceivers: empty(alertEmail) ? [] : [
      {
        name: 'operator'
        emailAddress: alertEmail
        useCommonAlertSchema: true
      }
    ]
  }
}

resource failedRun 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${logicAppName}-failed'
  location: 'global'
  tags: tags
  properties: {
    description: 'The daily Axiomate pass failed. Nothing was half-applied — the run is one transaction — but no conditions were raised, so nobody has been told what slipped overnight.'
    severity: 2
    enabled: true
    scopes: [
      scheduledPass.id
    ]
    /*
      An hour of window against a job that runs once a day, checked every fifteen minutes. The
      window has to outlast the retry sequence — four exponential attempts capped at five
      minutes apart, each allowed two minutes — or the alert would fire on the first attempt and
      resolve itself while the run was still succeeding on the third.
    */
    evaluationFrequency: 'PT15M'
    windowSize: 'PT1H'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'RunsFailed'
          metricNamespace: 'Microsoft.Logic/workflows'
          metricName: 'RunsFailed'
          operator: 'GreaterThanOrEqual'
          threshold: 1
          timeAggregation: 'Total'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [
      {
        actionGroupId: operators.id
      }
    ]
  }
}

@description('The Logic App, so the caller can grant it access or show it on a dashboard.')
output logicAppId string = scheduledPass.id

@description('The name to look for in the portal when somebody asks where the schedule lives.')
output logicAppName string = scheduledPass.name

@description('What it calls. Worth surfacing so a deployment against the wrong host is visible in the output rather than at seven tomorrow morning.')
output endpointUrl string = endpointUrl

@description('When it runs, in words, for the deployment summary.')
output runsAt string = '${padLeft(string(scheduleHour), 2, '0')}:${padLeft(string(scheduleMinute), 2, '0')} ${scheduleTimeZone}, every day'
