# Dashboards — an arrangement of what already exists, never a new number

> **Status, 10 September 2026 — reopened, in part, by the F&O page-grammar design.** The
> refusal below was reversed on two points and kept on the rest. Count tiles now exist as the
> home workspace (My work's summary row, Portfolio's score tiles — F&O's workspace pattern), and
> an engagement **health score** was admitted on the objection's own terms: its components are
> the six existing concern kinds, its weights are configuration (Configuration → Health score),
> every rendering prints the terms beside the number, and the client-pack score excludes
> `capacity` and says so. Nothing is stored. What stays refused: any number a `lib/` function
> does not already produce, and any score whose weights a reader cannot see. The per-person
> `DashboardLayout` arrangement proposed below was **not** built; it is superseded by the two
> workspaces. See `docs/plans/2026-09-10-fno-page-grammar-design.md` §5 and
> `lib/portfolio.ts`'s header for the reversal and its conditions.

*7 September 2026. From the Hive gap survey's "Dashboards" line. The obvious shape — tiles with
traffic-light colours and a blended score — is exactly what this codebase has refused twice
already, in writing.*

## The conflict, precisely

`lib/portfolio.ts`'s module comment is unambiguous, and it is quoted here rather than
paraphrased because paraphrasing is how a rule like this gets softened by accident:

> *"There is no health score, and there will not be one... A score is an argument about weights
> nobody can see, and the weights are the part worth arguing with."*

`lib/goals.ts` makes the same argument from a different angle — a goals dashboard's usual shape
(a ring chart at 73%) is precisely the drifting, untraceable number both files already rejected.
A conventional "Dashboards" feature — configurable tiles, each a KPI reduced to one number or one
colour — is not an extension of this codebase's reporting surface, it is the thing the reporting
surface was built to avoid becoming.

## The resolution: a dashboard is a layout, not a metric

Every screen this codebase already ships that reports *across* records —
`Portfolio` (named concerns per engagement), `Analytics` (cross-tabs over the register, this same
day's build), `MyWork` (ranked, and the ranking is shown) — already refuses a blended score and
already computes live from real data. None of them needed a "Dashboards" feature to exist; they
needed to be built once each, which they now are.

What is actually missing, once the score temptation is set aside, is **arrangement**: a person
who wants their own Portfolio concerns and their own Analytics age-bucket table on one screen,
without opening two, currently cannot have that. That is a real, narrow gap — and it is a layout
problem, not a metrics problem.

```prisma
model DashboardLayout {
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  /// One per person. Not a shared/team dashboard in this cut — see "What would send this back".
  personId String
  /// Ordered list of {widgetKind, size}. widgetKind is a closed enum naming an EXISTING pure
  /// function's output — 'portfolio' | 'analyticsSeverity' | 'analyticsClient' |
  /// 'analyticsAge' | 'analyticsOwner' | 'myWork' — never a new computation defined here.
  widgets Json

  updatedAt DateTime

  @@id([tenantId, personId])
}
```

**The load-bearing constraint: `widgetKind` can only ever name a function that already exists and
already returns named counts.** Adding a dashboard widget can never itself define a new metric —
that has to happen in `lib/portfolio.ts`, `lib/analytics.ts` or wherever the real computation
belongs, subject to those files' own doctrine, and only then does it become choosable here. This
file has no write path to a number; it only arranges panels that already refuse to lie.

## Where it surfaces

A new `Dashboard` view (sidebar, beside `Analytics`) — a grid of the chosen widgets, each
literally the existing component (`PortfolioPanel`'s concern list, `AnalyticsView`'s tables,
`MyWorkPanel`'s ranked list) rendered smaller, with an "Edit layout" mode to add, remove and
reorder. Nothing here is a new rendering — every widget is the real screen, embedded.

## What this does not do

No custom metrics, no formula builder, no colour thresholds a person sets themselves (a
self-configured "red above 5" is a hidden score with extra steps). No team or firm-wide shared
dashboard in this cut — every layout is one person's own arrangement of their own screen, the
same personal scope `MyCalendarPanel` already has. No auto-refresh interval setting — every widget
already recomputes on render, the same as opening its real screen would.

## What would send this back

- If people want to **share** a layout ("the partner review dashboard everyone on that engagement
  sees") — `DashboardLayout` keyed by `personId` cannot hold that; it would need a real
  shared/named-layout concept with its own access question, not assumed here.
- If a widget kind is requested that does not correspond to an existing pure function — the
  correct response is to build that computation properly in its own module first, under that
  module's own doctrine, not to loosen this file's constraint to let it in sideways.
