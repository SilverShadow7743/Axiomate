/*
  Mail intake — the last mile.

  ---------------------------------------------------------------------------
  Why this exists outside the application

  `app/api/intake/route.ts` says it plainly: the application is not a mail server, holds no
  mailbox credentials and polls nothing. Something has to receive the mail and POST it. This
  template is that something — a Consumption Logic App that watches one shared mailbox and posts
  each arriving message to `/api/intake` as the payload that endpoint already expects.

  Deliberately kept to a trigger and one HTTP call. Every rule about what the message becomes —
  which scope it is filed under, which routing rules fire, what severity was guessed rather than
  decided — lives in `lib/intake.ts`, where it is testable and where a consultant can read it.
  A connector that classified mail would be a second, invisible copy of that logic.

  ---------------------------------------------------------------------------
  Rejected alternatives

  A Graph change-notification subscription would push instead of poll and would cost nothing
  when idle, but it needs an app registration, a publicly reachable webhook, and renewal every
  few days or intake stops with no error. For one mailbox at a firm's volume, that is more
  moving parts than the polling bill it saves.

  A mailbox forwarding rule into a Logic App Request trigger would need the workflow's SAS URL
  to be treated as a secret in Exchange, where nobody would ever look for it.

  ---------------------------------------------------------------------------
  This deploys inert and stays inert until a person authorises it

  The Office 365 connection below is created without credentials, because OAuth consent cannot
  be granted by a deployment — a person has to click Authorise on the connection in the portal.
  Until they do, the workflow deploys clean, reports no errors, and never runs: the trigger
  cannot poll a mailbox it has no consent for. An empty run history looks exactly like a quiet
  mailbox, which is why `docs/intake.md` starts its troubleshooting at the connection and not at
  the run history.
*/

@description('Where the Logic App and its connection live. The connection must be in the same region as the workflow, because the managed API is resolved per region.')
param location string = resourceGroup().location

@description('Name of the Logic App. It appears in the portal, so name it after what it does. One per watched mailbox.')
param logicAppName string = 'axiomate-intake'

@description('The shared mailbox to watch, e.g. support@axiocloudsolutions.com. This same address is sent as the payload\'s `to`, so it must match an address configured under Configuration → Routing & intake exactly, or every message is refused with 422.')
param mailboxAddress string

@description('The application\'s host name, without scheme or path — for example axiomate.azurewebsites.net.')
param appHostName string

@description('The shared secret the endpoint requires, the same value as AXIOMATE_INTAKE_TOKEN. Supply it from Key Vault via getSecret() in the calling template — keyvault.bicep holds it as `axiomate-intake-token` — and never as a literal, so it lands neither in source nor in the deployment history.')
@secure()
param intakeToken string

@description('Minutes between mailbox checks. This is the whole cost driver — see the cost note in docs/intake.md — and it is also the worst-case delay between a client sending and an issue existing.')
@minValue(1)
@maxValue(60)
param pollMinutes int = 3

@description('Name of the Office 365 API connection. A separate resource from the workflow so that reauthorising it does not touch the workflow, and so a redeployment of the workflow cannot drop the consent.')
param connectionName string = '${logicAppName}-office365'

@description('Tags applied to everything this file creates.')
param tags object = {}

/* The endpoint is fixed by the application; only the host varies per environment. */
var intakeUrl = 'https://${appHostName}/api/intake'

/*
  The connection carries no `parameterValues`, and that is not an omission.

  An Office 365 connection is authorised by a human OAuth consent, which no ARM deployment can
  perform. Deploying this resource creates a connection in the `Unauthenticated` state; the
  workflow that references it will not poll until somebody opens it and grants access.

  Authorise it as a service account that has been given read access to the shared mailbox, not
  as whoever happened to run the deployment. The consent is bound to that identity, so intake
  stops the day an individual leaves the firm and their account is disabled.
*/
resource office365 'Microsoft.Web/connections@2016-06-01' = {
  name: connectionName
  location: location
  tags: tags
  properties: {
    displayName: 'Axiomate intake — ${mailboxAddress}'
    api: {
      id: subscriptionResourceId('Microsoft.Web/locations/managedApis', location, 'office365')
    }
  }
}

resource workflow 'Microsoft.Logic/workflows@2019-05-01' = {
  name: logicAppName
  location: location
  tags: tags
  properties: {
    state: 'Enabled'
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      parameters: {
        '$connections': {
          type: 'Object'
          defaultValue: {}
        }
        /*
          Declared here and given its value in `properties.parameters` below. Both halves are
          required: a declaration without a value deploys perfectly happily and then sends an
          empty bearer token, which the endpoint answers with 401 on every single message.

          `SecureString` means the value is not returned by a read of the workflow, so the token
          does not leak to anyone with Reader on the resource group.
        */
        intakeToken: {
          type: 'SecureString'
        }
        intakeUrl: {
          type: 'String'
        }
        mailboxAddress: {
          type: 'String'
        }
      }
      triggers: {
        /*
          `splitOn` gives one workflow run per message rather than one run per batch, so a
          message the endpoint refuses fails its own run and the rest still land.

          `includeAttachments` is false on purpose. The application stores no files — evidence
          items hold a URL, and for anything not already on the web that URL only survives the
          browser session that made it (`lib/evidence.ts`). Pulling attachment bytes across just
          to drop them would cost money and prove nothing. What the client sent stays in the
          mailbox, and the note below tells the consultant it is there.

          Every other option on this trigger is left at its default — Inbox, any importance, no
          subject filter. Naming them would add wire names to be wrong about for no change in
          behaviour.
        */
        When_a_new_email_arrives_in_the_shared_mailbox: {
          type: 'ApiConnection'
          recurrence: {
            frequency: 'Minute'
            interval: pollMinutes
          }
          splitOn: '@triggerBody()?[\'value\']'
          inputs: {
            host: {
              connection: {
                name: '@parameters(\'$connections\')[\'office365\'][\'connectionId\']'
              }
            }
            method: 'get'
            path: '/v2/SharedMailbox/Mail/OnNewEmail'
            queries: {
              mailboxAddress: '@parameters(\'mailboxAddress\')'
              includeAttachments: false
            }
          }
        }
      }
      actions: {
        /*
          One call, and the reply is the whole result: 2xx means a work item exists, anything
          else fails the run and turns the row red in run history. The default retry policy is
          left alone — it retries 429s and 5xx, which is right for a database that is briefly
          away, and does not retry 4xx, which is right for a message that will be refused just as
          firmly the second time.
        */
        Post_the_message_to_Axiomate: {
          type: 'Http'
          runAfter: {}
          inputs: {
            method: 'POST'
            uri: '@parameters(\'intakeUrl\')'
            headers: {
              'Content-Type': 'application/json'
              Authorization: '@{concat(\'Bearer \', parameters(\'intakeToken\'))}'
            }
            body: {
              /*
                `to` is the mailbox this workflow watches, not the message's To: header.

                The header is a semicolon-joined list that frequently does not contain this
                mailbox at all — mail sent to a distribution list, to an alias, or blind-copied
                still arrives here, and `classify()` selects the mailbox by exact match on `to`.
                Sending the header would refuse those messages with "No mailbox is configured
                for ...", naming an address the firm never configured, which is a bewildering
                thing to read at eight in the morning. Sending the watched address means the
                only way to get that refusal is genuine drift between this parameter and
                Configuration → Routing & intake.
              */
              to: '@parameters(\'mailboxAddress\')'
              from: '@triggerBody()?[\'from\']'
              subject: '@triggerBody()?[\'subject\']'
              /*
                The body is passed through as the mail server sent it, HTML and all.

                The Content Conversion connector would flatten it to text, and was rejected: it
                is still in preview, it is a second managed connection that must also exist and
                also be right, it doubles the per-message connector cost, and by its own
                documentation it discards hyperlinks and hard-wraps at eighty characters.
                Losing the link a client sent, silently, is worse than showing them tags.

                The appended line exists because the application will never hold the file. A
                consultant reading "as per the attached spreadsheet" with nothing attached and
                nothing said assumes Axiomate lost it; this tells them where it actually is.
              */
              body: '@{triggerBody()?[\'body\']}@{if(equals(triggerBody()?[\'hasAttachment\'], true), concat(decodeUriComponent(\'%0A%0A\'), \'[Axiomate intake] This message arrived with one or more attachments. Axiomate does not store files, so they were not captured — they are still on the original message in \', parameters(\'mailboxAddress\'), \'.\'), \'\')}'
              /*
                The single most important line in this file.

                `route.ts` refuses a message it has already seen by searching existing notes for
                this string, and every accepted message is recorded with `Message id: <value>`.
                So this value is the only thing standing between the firm and duplicate work
                items when a run is resubmitted, when the connector restarts mid-batch, or when
                a retry lands after the record was already created.

                `internetMessageId` is the RFC 2822 id the sender's own mail server stamped on
                the message. It never changes. The other candidate, the Graph `id`, is a
                per-mailbox handle that changes when the message is moved to another folder — so
                a resubmitted run for a message somebody has since filed would carry an id
                nothing had seen before, and quietly raise the same issue twice.

                There is no fallback here on purpose. If this field is ever absent the endpoint
                answers 400 and the run goes red, which is a question somebody can answer. A
                fallback to the Graph id would answer 200 and duplicate the work instead.
              */
              messageId: '@triggerBody()?[\'internetMessageId\']'
              /*
                When the client sent it, not when we noticed. If this is ever absent the endpoint
                stamps its own arrival time, which is out by at most one polling interval — worth
                knowing before anybody reasons about response times from it.
              */
              receivedAt: '@triggerBody()?[\'receivedDateTime\']'
            }
          }
        }
      }
      outputs: {}
    }
    parameters: {
      '$connections': {
        value: {
          office365: {
            connectionId: office365.id
            connectionName: connectionName
            id: subscriptionResourceId('Microsoft.Web/locations/managedApis', location, 'office365')
          }
        }
      }
      intakeToken: {
        value: intakeToken
      }
      intakeUrl: {
        value: intakeUrl
      }
      mailboxAddress: {
        value: mailboxAddress
      }
    }
  }
}

@description('The name to look for in the portal when somebody asks where intake lives.')
output logicAppName string = workflow.name

@description('The Logic App, so the caller can put it on a dashboard or hang an alert off it. Nothing here alerts on a failed run — schedule.bicep does that for the scheduled pass, and the same pattern applies if the firm wants it.')
output logicAppId string = workflow.id

@description('The connection that has to be authorised by a person. Surfaced so the deployment summary names the resource somebody must go and click.')
output connectionResourceId string = office365.id

@description('What it posts to. Worth surfacing so a deployment against the wrong host is visible in the output rather than the first time a client emails.')
output endpointUrl string = intakeUrl

@description('Which mailbox this deployment watches. This is also the address Axiomate must have configured under Routing & intake, so the two can be compared without opening the template.')
output watchedMailbox string = mailboxAddress

@description('Open this and press Authorise, or nothing will ever arrive. See docs/intake.md.')
output authoriseConnectionUrl string = 'https://portal.azure.com/#resource${office365.id}'
