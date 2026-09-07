# Hive comparison — configuration, setup, and screen density

*7 September 2026. Requested directly against Hive's real product, not assumption. Hive facts
below are sourced from Hive's own help centre and independent reviews (linked at the end);
Axiomate facts are read directly from this codebase and this session's own browser screenshots
of the hosted app.*

## Configuration

**Hive: ~25 named settings across four categories, plus an opt-in "Apps" layer.** Per Hive's own
admin settings help page: General (7 — workspace name/logo, working week, holidays, currency,
show private actions, show project ID), Action defaults (1), Project defaults (11 — weekend
actions, subaction display, default template, Gantt auto-scheduling, custom statuses/fields,
proofing routing, timesheet approver, and which apps a new project starts with), and Apps (a
toggle list — Time-tracking, Forms, Resourcing, Goals, Proofing & Approvals, Agile, each with its
own sub-settings once turned on). The defining trait: most functionality ships **off**, and an
admin turns on only what the firm uses.

**Axiomate: 26 named configuration tabs, all always present.** `ConfigWorkspace.tsx`'s own `TABS`
array: Capabilities, Terminology, Roles & people, Work types, Disciplines, Rates, Skills, Service
levels, Status transitions, Permissions, Approvals, Automation, Scheduled pass, Time recording,
Allocation, T-shirt sizing, Responsibilities, Agent registry, Recurring work, Workflows &
templates, Routing & intake, Blueprints, Scope overrides, Duplicates, Goals — grouped under
"Operating model / Automation / Governance," not gated behind an on/off switch. Nothing is hidden
because a firm hasn't used it yet; an unused tab shows an honest empty state instead (the same
"absence is the honest answer" rule this codebase applies everywhere — `unassignedUnder`,
`applicationConcerns`, `checklistFor` all report zero rather than disappearing).

**The real difference is philosophy, not count.** Hive hides breadth until asked for it — the
tradeoff is a firm has to know a capability exists before turning it on, and Hive's own users
report exactly that friction ("steep learning curve... can overwhelm new users with its extensive
functionalities" — multiple 2026 reviews). Axiomate shows the whole operating model at once and
relies on empty states to keep an unused tab from lying about being populated. Neither is simply
better: Hive's model protects a first-time user from 25 settings they don't need yet; Axiomate's
model means nothing is ever a surprise once discovered, at the cost of a fuller settings menu on
day one.

## Setup

**Hive**: a three-phase onboarding — personal task entry first (add to a Home list before any
team exists), then team assembly (invite, organize into departments), then project creation
(template or blank, layout choice, sharing permissions) — explicitly sequenced so a new user acts
before configuring anything.

**Axiomate**: no comparable first-run wizard for a brand-new tenant exists as a distinct
onboarding flow — `lib/firstRun.ts`'s checklist computes itself from state and retires on
evidence (an in-context nudge list, not a sequenced setup wizard), and the real onboarding this
session actually did (provisioning the tenant, Entra registration, seeding the operating model)
was infrastructure work, not a product-level guided setup a new user walks through.

## Screen density

**Hive favours progressive disclosure and single-focus panels.** Per Hive's own navigation
documentation, the philosophy is consolidated views over multiple simultaneous panels — "My
Actions" is designed to be read "at a glance," and specialised views (Portfolio, Analytics) are
opened as toggleable apps rather than kept as permanent on-screen panels. Independent reviews
call the *result*, once several apps are turned on, "cluttered" and something that can
"overwhelm... with its extensive functionalities" — so the progressive-disclosure design and the
lived complexity complaint coexist in Hive's own reviews.

**Axiomate is denser by design, on the screens this session actually opened.** `CommercialPanel`
shows Scope, the payment schedule, Invoices and Change Requests stacked in one continuous scroll
per SOW — not tabs a person switches between. `PortfolioPanel` puts every engagement's named
concerns on one screen with no drill-in required to see what is wrong. The Engagement drawer
observed directly in this session's own browser check showed Overview, linked Statements of Work,
their milestones and now their invoices all in one panel. This is a deliberate trade this
codebase's own doctrine states repeatedly (`lib/portfolio.ts`: *"name the concerns, count them,
and let the reader do the weighing"*) — density in service of not making a partner click through
five screens to find what needs attention, at the cost of more visible surface on any single
screen than Hive's own stated design goal admits.

## Where this leaves the two products

Hive optimises for a new team's first week — hide what isn't needed yet, reveal capability as it
is turned on, and accept that a power user with six apps enabled will find the result cluttered
(their own reviewers say so). Axiomate optimises for the read a partner or engagement lead
already does daily — put the concerning facts on one screen, accept a fuller settings surface up
front, and never let an empty section vanish and read as "nothing to see" when it might mean
"nobody has looked yet." Neither trade is free, and neither is stated as a criticism of the
other — they are answers to different first questions ("how do I not overwhelm someone new" vs.
"how do I not make someone go looking for a fact that should already be in front of them").

## Sources

- [Quick-Start Guide | Hive Help](https://help.hive.com/en/articles/2195626-quick-start-guide)
- [Workspace Settings for Admins | Hive Help](https://help.hive.com/en/articles/4306095-workspace-settings-for-admins)
- [How to Navigate Your Hive Workspace | Hive](https://hive.com/blog/how-to-navigate-hive-workspace/)
- [Hive Review 2026: Pros, Cons, Features & Pricing](https://thedigitalprojectmanager.com/tools/hive-review/)
- [Hive Pros and Cons | User Likes & Dislikes (G2)](https://www.g2.com/products/hive-hive-hive/reviews?qs=pros-and-cons)
