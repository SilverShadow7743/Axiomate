# Hive comparison — configuration, setup, and screen density

*7 September 2026, corrected 8 September 2026. The 7 Sep version was sourced from Hive's help
centre and independent reviews — secondary sources. On 8 Sep, at the user's request, this was
re-verified against Hive's actual live product (signed into a real workspace, "Alpha Variance
Solutions" / "FnO Technical Team", as an Admin). The Configuration section below turned out to be
materially wrong — Hive's real settings and app surface is far larger than the secondary sources
described, and missed an entire category (AI) that didn't exist in whatever version those sources
were written against. Screen Density was spot-checked against a real project ("Client Project" —
Overview and Gantt tabs) and holds up; its text is unchanged, now confirmed live rather than
sourced. **Setup was not re-verified** — the live workspace was already provisioned, so there was
no first-run flow to walk through; that section is still secondary-sourced and marked as such
below. Axiomate facts are read directly from this codebase and this session's own browser
screenshots of the hosted app.*

## Configuration

**Corrected, from the live product: Hive's real configuration surface is 6 settings categories
plus a 54-app library — significantly larger than the ~25-setting, 6-app-toggle picture the
secondary sources gave.**

Workspace settings (`Settings → Workspace`), confirmed live as Admin:

| Category | Sections |
|---|---|
| General | Workspace overview, Defaults, Apps |
| People | Manage users, Teams |
| Customization | Labels, Custom fields, Custom statuses, Templates |
| AI | AI configuration |
| Advanced | Webhooks |
| Data | Trash bin, Email to actions |

- **Workspace overview**: logo, name, brand color, working week, currency, holiday schedule
  (Workspace identity, 6), plus Show private actions / Show project ID / domain auto-join
  (Policies and access, 3), plus Delete workspace (Danger zone).
- **Defaults**: Action defaults (subaction update prompt — assignees/status/labels), Workspace
  defaults (default home page template, for internal and external users), and Project defaults
  (weekend actions, public-by-default, default template, client project location, Kanban
  settings, auto-add teams, auto-scheduling, statuses, custom fields, and which apps a new
  project starts with) — 15+ individual settings, not the "1 + 11" the secondary sources gave.
- **Apps**: this live workspace has **10 apps enabled** (Portfolio Summary, Forms, Dependencies,
  Messaging, Show Action Simple Id, Project Baselines, Custom Emojis, Risks And Issues, Priority
  Levels, Project Linking) — none of which match the six named in the 7 Sep version
  (Time-tracking, Resourcing, Goals, Proofing & Approvals, Agile — only "Forms" survived). "Manage
  apps" opens Hive's **App Library**: **54 apps total**, split AI (6), Premium (7), Workspace (28),
  Personal (13). AI is a first-class, top-level category — Buzz Assistant, AI Workflows, AI
  Dashboards, all marked "Included" — and did not exist anywhere in the 7 Sep sourcing. Turning
  an app on is a marketplace action (App Library → enable), not a settings-page toggle, which is
  itself a structural difference the secondary sources didn't capture.

The defining trait named on 7 Sep still holds and is now confirmed live: most functionality ships
**off**, and an admin turns on only what the firm uses — it just turns on from a 54-item library,
not a 6-item list.

**Axiomate: 26 named configuration tabs, all always present.** `ConfigWorkspace.tsx`'s own `TABS`
array: Capabilities, Terminology, Roles & people, Work types, Disciplines, Rates, Skills, Service
levels, Status transitions, Permissions, Approvals, Automation, Scheduled pass, Time recording,
Allocation, T-shirt sizing, Responsibilities, Agent registry, Recurring work, Workflows &
templates, Routing & intake, Blueprints, Scope overrides, Duplicates, Goals — grouped under
"Operating model / Automation / Governance," not gated behind an on/off switch. Nothing is hidden
because a firm hasn't used it yet; an unused tab shows an honest empty state instead (the same
"absence is the honest answer" rule this codebase applies everywhere — `unassignedUnder`,
`applicationConcerns`, `checklistFor` all report zero rather than disappearing).

**Corrected: the difference is philosophy AND count, not philosophy alone.** The 7 Sep version
called this "philosophy, not count" on the strength of a roughly-25-vs-26 comparison; live-checked,
Hive's real surface (13 settings sections plus a 54-app library) is meaningfully larger than
Axiomate's 26 always-on tabs. Hive hides more breadth than it appeared to, and turns it on from a
genuine marketplace rather than a settings list. Axiomate shows the whole operating model at once
and relies on empty states to keep an unused tab from lying about being populated — that
philosophical difference still holds, and is now the *larger* of the two effects, not a wash
against a similar raw count.

One structural point the secondary sources missed entirely: Hive's AI is a marketplace category —
Buzz Assistant, AI Workflows, AI Dashboards live in the App Library beside Forms and Dependencies,
each independently enabled. Axiomate has no equivalent marketplace; its one AI-adjacent surface is
the single "Agent registry" config tab, which governs named agents' autonomy and permitted actions
as operating-model data, not as installable apps. Neither is a partial version of the other — Hive
treats AI capability as something a workspace turns on piece by piece; Axiomate treats it as one
more thing the operating model states rules about. Hive's own users report the breadth-until-asked
model has a cost ("steep learning curve... can overwhelm new users with its extensive
functionalities" — multiple 2026 reviews), and a 54-app library is a larger version of exactly that
tradeoff than the 6-app picture in the 7 Sep sourcing suggested.

## Setup

*Not re-verified live on 8 Sep — the workspace signed into was already provisioned, with no
first-run flow left to walk through. Still sourced from Hive's help centre, unchanged from 7 Sep.*

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

*Spot-checked live 8 Sep against a real project ("Client Project," Alpha Variance Solutions
workspace): Overview and Gantt are separate tabs, each a single focused view — Overview stacks
Status, Project completion, and Project activity as vertical widgets, never side-by-side panels.
Matches the characterization below; text is unchanged from 7 Sep.*

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

*Revised 8 Sep — the 7 Sep close read as a wash ("neither trade is free... answers to different
first questions"). The live check doesn't overturn that framing, but it does mean the scale on
Hive's side of it is bigger than stated.*

Hive optimises for a new team's first week — hide what isn't needed yet, reveal capability as it
is turned on from a genuine 54-app marketplace, and accept that a power user with several apps
enabled will find the result cluttered (their own reviewers say so, and the real library is nearly
double the width the secondary sources suggested). Axiomate optimises for the read a partner or
engagement lead already does daily — put the concerning facts on one screen, accept a fuller
settings surface up front (though still a smaller one than Hive's, once Hive's app library is
counted), and never let an empty section vanish and read as "nothing to see" when it might mean
"nobody has looked yet." Neither trade is free, and neither is stated as a criticism of the
other — they are answers to different first questions ("how do I not overwhelm someone new" vs.
"how do I not make someone go looking for a fact that should already be in front of them"). What
changed on re-verification is confidence in the numbers behind that framing, not the framing
itself.

## Sources

**Live-verified, 8 Sep** — signed into a real Hive workspace ("Alpha Variance Solutions" /
"FnO Technical Team") as Admin: Workspace settings (all sections), App Library, and one real
project ("Client Project," Overview + Gantt tabs). This is now the primary source for Configuration
and Screen density; the secondary sources below are kept for Setup, which was not re-walked.

- [Quick-Start Guide | Hive Help](https://help.hive.com/en/articles/2195626-quick-start-guide)
- [Workspace Settings for Admins | Hive Help](https://help.hive.com/en/articles/4306095-workspace-settings-for-admins)
- [How to Navigate Your Hive Workspace | Hive](https://hive.com/blog/how-to-navigate-hive-workspace/)
- [Hive Review 2026: Pros, Cons, Features & Pricing](https://thedigitalprojectmanager.com/tools/hive-review/)
- [Hive Pros and Cons | User Likes & Dislikes (G2)](https://www.g2.com/products/hive-hive-hive/reviews?qs=pros-and-cons)
