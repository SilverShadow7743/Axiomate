# Application Suite — a client's own technology landscape

*7 September 2026. A design, not an increment — from `docs/pending-actions.md` section J's gap
survey, which named this the strongest near-term candidate among the entirely-unbuilt suites:
zero-AI-needed, structural, and sitting directly on Axiocloud's own delivery specialism (D365
F&O, Commerce, Azure, Fabric, Power Platform implementations) rather than a generic PM concept.
The source pitch itself flags it as "a candidate flagship capability."*

## What this actually is, here

Not a monitoring product. `axiomate-product-blueprint.md`'s APP-001 through APP-007 describe live
telemetry, cost tracking and AI-driven business-impact reasoning — most of that needs a real
monitoring feed or an LLM this codebase doesn't have (APP-006's "Integration failure → Order
process affected → ... → Revenue exposure" chain is squarely the generative reasoning
`axiomate-vision.md` §6 already names as blocked). What's buildable now, honestly: **the record**
— which systems a client runs, what Axiocloud delivers against, how they connect, and which open
issues sit against each — the same "read real structured data, name a concern, never invent a
fact" discipline every other suite in this codebase already follows.

## What already exists, and the gap in it

`Issue.module` (`prisma/schema.prisma`) is free text today — 21 distinct values in the live
register (Finance, Production, Procurement, Inventory, Reporting, …). That's already, informally,
"which part of the client's system this issue is about" — but it's a string with no identity: two
issues both saying `"Finance"` aren't provably about the same environment, there's no record of
which platform (D365 F&O vs. Commerce vs. a Power Platform app) it belongs to, and nothing
distinguishes a PROD issue from a UAT one except free text in the issue body. `DISC_ENVIRONMENT`
(`lib/config.ts:426`, "DEV, UAT, PROD or deployment issue") already names environment as a real
classification axis at the discipline level — this design gives it something to point at.

## Schema

```prisma
model Application {
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  /// Application-supplied, per this schema's own rule 1 — `app:oapil-d365fo-prod`.
  id           String
  /// The client this belongs to. A HierarchyNode of kind 'client' — never a raw string, so an
  /// application cannot outlive or misspell the client it's scoped to.
  clientNodeId String
  clientNode   HierarchyNode @relation(fields: [tenantId, clientNodeId], references: [tenantId, id], onDelete: Restrict)

  name        String
  /// D365 F&O | D365 Commerce | D365 CE | Salesforce | Power Platform | Azure service | Fabric |
  /// Custom | ... — free text like Engagement.type, for the same reason: a firm running a
  /// platform this list doesn't name should not be blocked from recording it.
  platform    String
  /// DEV | UAT | PROD | ... — matches DISC_ENVIRONMENT's own vocabulary. Two rows, one per
  /// environment, for the same "Finance" module — never one row with an environment list,
  /// because health and issues differ per environment and collapsing them would hide that.
  environment String @default("")

  /// Planned | Live | Decommissioned. Lifecycle, not health — see "Health" below for why the two
  /// are different questions answered by different mechanisms.
  status      String
  goLiveDate  DateTime?
  /// Free text, same accountable-party vocabulary pattern as Issue.accountable.
  owner       String  @default("")
  ownerId     String?
  vendor      String  @default("")
  description String  @db.Text

  recordedBy String
  recordedAt DateTime
  deletedAt  DateTime?

  issues              Issue[]
  integrationsFrom     IntegrationLink[] @relation("Source")
  integrationsTo       IntegrationLink[] @relation("Target")

  @@id([tenantId, id])
  @@index([tenantId, clientNodeId])
}

model IntegrationLink {
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  id                   String
  sourceApplicationId  String
  sourceApplication    Application @relation("Source", fields: [tenantId, sourceApplicationId], references: [tenantId, id], onDelete: Cascade)
  targetApplicationId  String
  targetApplication    Application @relation("Target", fields: [tenantId, targetApplicationId], references: [tenantId, id], onDelete: Cascade)

  /// "OData export", "Power Automate flow", "SFTP batch" — free text, not a fixed integration
  /// technology enum; this firm's clients run every era of Microsoft integration tooling at once.
  interface       String
  /// What the integration is FOR, in business terms — "Order fulfilment", "GL posting". Recorded
  /// now, deliberately, even though nothing consumes it yet: APP-006's consequence-chain
  /// reasoning (a later, AI-blocked capability) needs exactly this fact and cannot infer it from
  /// a technical interface name. Recording it today is cheap; reconstructing it later from
  /// memory is not.
  businessProcess String @db.Text @default("")
  frequency       String @default("")
  status          String @default("Active")

  recordedBy String
  recordedAt DateTime
  deletedAt  DateTime?

  @@id([tenantId, id])
  @@index([tenantId, sourceApplicationId])
  @@index([tenantId, targetApplicationId])
}
```

`Issue` gains one optional field: `applicationId String?`, alongside — not replacing — the
existing free-text `module`. Additive on purpose: 21 existing values don't necessarily map 1:1
onto real Application records yet, and forcing that reconciliation as a migration would be
inventing structure the data doesn't currently support. `module` stays exactly as it is; a new
issue can optionally also name a real Application.

## Health — named concerns, not a score, matching `lib/portfolio.ts`'s own doctrine

`lib/portfolio.ts` states this precisely: *"There is no health score, and there will not be one...
name the concerns, count them, and let the reader do the weighing."* The blueprint's APP-005
proposes exactly the pattern that doctrine was written to reject (`Healthy → Watch → At Risk →
Critical`). This design follows the codebase's own precedent instead:

```ts
export const APPLICATION_CONCERN_ORDER = ['openCritical', 'overdue', 'integrationsInactive', 'stale'] as const

interface ApplicationConcern {
  kind: (typeof APPLICATION_CONCERN_ORDER)[number]
  count: number
  phrase: string  // "3 open Critical issues", "2 integrations marked Inactive"
}
```

`applicationConcerns(app, issues, links)` — pure, no clock, no I/O, same shape as
`portfolio.ts`'s per-engagement concerns — reads: open issues against this application by
severity/age (reusing whatever `lib/watch.ts`'s `overdue`/`stale` conditions already compute
rather than re-deriving them), and `IntegrationLink`s whose `status` is `Inactive` where the
application is source or target. An application with none says so, the same rule
`EngagementDetail` already follows for absent data.

## Where it surfaces

- **Application Landscape** — a per-client list (name, platform, environment, concerns), the same
  "every X at once" shape `PortfolioPanel.tsx` already establishes for engagements. Natural home:
  a tab alongside Portfolio, or nested under the client's own hierarchy view.
- **Application Workspace** — Overview (platform, environment, vendor, go-live, owner), linked
  Issues (the existing `TreeGrid`/list, filtered by `applicationId` the same way it already
  filters by other facets), Integrations (in/out list from `IntegrationLink`), Concerns.

## What this does not do

Live telemetry — no availability/performance/latency feed; `IntegrationLink.status` is a person's
own record of what they know, not a monitored fact, and is worded as such in the UI. No cost
tracking — no licensing or spend data source exists to back it honestly. No security/customization
health dimensions — would need real scan inputs this application doesn't have. No AI-driven
consequence-chain reasoning (APP-006) or predictive application-failure detection (part of
INT-005) — both need the generative capability `axiomate-vision.md` already names as blocked;
this design's `businessProcess` field on `IntegrationLink` is deliberately there so that
capability has real data to reason over once it exists, not an attempt to build the reasoning now.

## What would send this back

- If a client's applications are commonly shared across engagements or, rarer, across clients (a
  shared Azure landing zone) — the one-`clientNodeId`-per-Application model breaks and needs a
  many-to-many, not assumed here because Axiocloud's typical engagement shape is one client, one
  buildout.
- If reconciling the 21 existing `Issue.module` free-text values against real Application records
  turns out to matter enough to force sooner — that's a data-migration decision for whoever owns
  the register, not implied by this design; `applicationId` stays optional until then.
