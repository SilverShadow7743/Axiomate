# Hosting Axiomate in the Axiocloud Solutions Azure tenant

A decision paper. It says what would be hosted, what it holds, where it should sit, what it
would cost, what the alternatives are and why they were not chosen, what hosting will not fix,
and what has to be decided by a person before anything is provisioned.

Nothing in this paper has been provisioned. It is written to be approved, amended or refused.

---

## 1. What is being hosted

Axiomate is the delivery-management application Axiocloud Solutions uses to run its client
engagements. It holds the issue log for each client — what was raised, by whom, on what date,
who owns it, what state it is in and what happens next — and around that log it holds the
things a delivery firm needs in order to answer for the work: the schedule and the resolution
plan, the hours people have booked against each item, the estimates those hours are being
measured against, the statements of work the engagements are delivered under, the approvals
somebody with authority gave or refused, and a complete audit trail of every change ever made
to any of it.

In plain terms, it is the system of record for what Axiocloud owes its clients and what it has
done about it. Today it runs on one machine, from a file, for one person at a time. Hosting it
means it becomes a service the delivery team signs into, that keeps what they type, that runs
its own overnight checks, and that a client could in principle be shown.

The application is a Next.js web application with a PostgreSQL database behind it. Its network
surface is small and worth reading in full, because two items on it are the reason this paper
exists. There is sign-in through Microsoft Entra ID; the write endpoint the browser posts every
change to; the assistant endpoint; a health endpoint the hosting platform polls to decide
whether an instance should be given the next request; an intake endpoint that accepts an
inbound message from outside the firm and files it as work; and a scheduled-pass endpoint that
something external calls once a day to raise service-level breaches and send notifications.
The last two do nothing at all unless something outside the application calls them. Nothing in
this codebase wakes itself up and nothing reads a mailbox, by design — a timer inside a web
server stops when the process restarts and runs twice when there are two instances — so the
scheduler and the mail connector are hosting, not features, and they arrive with this decision
or not at all.

---

## 2. The data, and which of it is confidential

The database has twenty-one tables. Their contents fall into four groups, and it is the third
and fourth that decide everything else in this paper.

**Client issue logs.** The seeded data is 131 real issues across two clients, OAPIL (94) and
SLG (37), raised between 4 May and 13 August 2026, across twenty-three process areas from
Inventory and Procurement to point-of-sale fulfilment and carrier integration. Each row carries
a subject, a narrative description of what went wrong and what was done about it, the client
impact, the next action, and a quoted evidence snippet. These are not sanitised summaries: the
descriptions name production systems, failed postings, blocked releases, branch names, vendor
products and the specific commercial arguments that were had about them.

**Named individuals.** The log carries 37 distinct owner values and 27 distinct raiser values,
and the great majority are real people's names on both sides — Axiocloud's consultants and the
clients' own staff. Beyond the log, the operating model holds a person directory with roles,
`Allocation` records who is committed to which project and at what share of their time, and
`Commitment` records leave, public holidays and internal time. That last pair is employee
personal data: taken together they say who was off work, when, and for how long. Every audit
row and every note names its author. There is no anonymisation anywhere in the schema, and
there should not be — the product's whole argument is that a record without an attributed
author is not a record of anything.

**Client commercial terms.** `Sow` holds the statement of work behind each engagement: its
reference, its contracted value as a decimal amount with a currency (the schema's default is
GBP), the baselined effort in hours, the signature and term dates, and the scope, exclusions
and acceptance criteria in full text. `IssueEstimate` holds Axiocloud's own view of how much
work each item is — complexity scores, approved effort, assumptions — which read against the
contracted value is the firm's margin. `TimeEntry` holds hours to two decimal places, per
person, per day, per issue, with a billable flag, which is the raw material of an invoice.
`Approval` records who was asked to authorise a change and what they decided.

**Axiocloud's own record.** A second log of 79 entries — defects and limitations found while
building the application itself — lives in the same database as the client data. It is the
firm's internal defect register, and it is candid.

The short version for a security questionnaire is this: the database contains client
confidential information, personal data relating to identified individuals on both the client
and supplier side, and commercially sensitive contract and margin data. There is nothing in it
that is merely operational telemetry.

Two things it does **not** contain today. Evidence *records* are stored — what was attached,
by whom, and what it was meant to prove — but the **files are not**. There is no upload
backend, so a screenshot lives in one browser session and is gone on reload. The moment file
upload is built, Blob Storage, its access controls and its own backup enter both the
architecture and the bill, and the confidentiality profile gets worse rather than better,
because attachments in this domain are screenshots of production systems. Second, there are no
payment card details, no credentials belonging to clients, and no health data.

---

## 3. "Tenant" means two different things here

This needs stating before the region discussion, because the two meanings collide in one
configuration file and a paper that confused them would be worth nothing.

An **Azure tenant**, or Entra tenant, is Axiocloud Solutions' Microsoft directory — the thing
that holds the firm's staff accounts, its subscriptions and its administrative roles. There is
one, it belongs to Axiocloud, and it is what a person means by "our Azure tenant".

An **Axiomate tenant** is a row in the application's `Tenant` table, and it means *the delivery
firm whose workspace this is*. The application is built so that two different firms could run
Axiomate without ever seeing each other's data: every table carries a tenant id, every
application-generated identifier is unique only within one, and every database query names one.
In this deployment there is exactly one such row, with the slug `axiocloud`.

The two sit next to each other in the environment file — `AXIOMATE_TENANT` names the row,
`AXIOMATE_ENTRA_TENANT_ID` names the directory — and in this deployment both resolve to
Axiocloud, which is precisely why the conflation is so easy to make.

The consequence matters commercially, so it is worth being blunt about it. **OAPIL and SLG are
two clients inside one Axiomate tenant. Tenant scoping is not what separates them from each
other — nothing does.** The isolation boundary the schema enforces sits between Axiocloud and a
hypothetical second delivery firm, not between one client of Axiocloud and another. Anyone with
access to the application sees both clients' issues, hours and contract values, exactly as
anyone with access to the firm's shared drive would. If a client asks how their data is
segregated from other clients of the same firm, the honest answer is "by access control over a
single shared workspace", and access control is discussed in section 7.

---

## 4. Region and residency

**The deciding constraint is not technical and is not in this repository.** Where this sits is
determined by what Axiocloud's client contracts and master services agreements say about where
client data may be processed and stored, and those documents are not here. What follows is a
decision rule and the evidence available, not a settled answer.

The rule, in order of precedence:

1. If any client contract, data-processing agreement or completed security questionnaire names
   a residency requirement — a country, a bloc, or a prohibition on a particular country — that
   requirement wins outright, for the whole deployment, because the database is not divisible by
   client.
2. Absent such a requirement, host in the region where Axiocloud is contractually domiciled and
   would answer a regulator, because that is the jurisdiction the firm can most easily defend
   in writing.
3. Latency is a tie-breaker and nothing more. This is an interactive planning tool used by a
   few dozen people, not a trading system; the difference between a well-chosen region and a
   badly-chosen one is perceptible but not commercially material.

The evidence in the repository points three ways and none of it is authoritative. The client
data reads as Gulf-region: the personal names in the OAPIL log are predominantly Omani, and one
issue names a Bahrain-registered counterparty. That is an inference from names in a seed file,
which is a weak basis for a hosting decision and is offered as a prompt to check the contracts
rather than as a finding. The delivery team's clock and locale are configured for India, which
tells you where the consultants sit and nothing about where the data may live. The schema's
default contract currency is GBP, which hints at a UK commercial entity.

On that evidence, the likely answer is **UAE North**, on the grounds that it keeps Gulf client
data in the Gulf, which is the answer that survives a client security questionnaire with the
least explanation. **UK South** is the alternative if the firm's contracting entity is British,
and **Central India** is the alternative if neither of the above holds and proximity to the
delivery team is the only live consideration. Any of the three is a defensible engineering
choice; only the firm can say which is a defensible commercial one.

Three practical checks before committing to a region, in this order. Confirm the region has
availability zones and that PostgreSQL Flexible Server offers zone-redundant high availability
there, because that option is not uniform across regions and it is easier to choose a region
around it than to migrate later. Confirm every service in section 5 is actually offered in the
region — service availability lags in newer regions. And decide where **backups** go, because a
geo-redundant backup lands in the paired region and a residency clause that a client reads as
"in country" is broken by a backup in a different one; this is the most commonly missed half of
a residency commitment.

Finally, note what hosting in Azure adds to the client relationship regardless of region:
Microsoft becomes a sub-processor of the client's data. Most client agreements require that to
be disclosed and some require prior consent. That is a letter somebody has to send, not a
configuration setting.

---

## 5. What it would cost

> Every figure below is an **indicative list price in US dollars**, for the purpose of deciding
> whether this is a hundred-dollar decision or a ten-thousand-dollar one. Azure bills in the
> subscription's currency, list prices vary by region by a material margin, and any figure taken
> to a finance meeting should come from the Azure pricing calculator for the chosen region and
> the actual subscription. What this paper stands behind is the **shape** of the bill and the
> **choice of tiers** — those are the decisions — not the third significant figure.

### The shape of a sensible small deployment

| Component | What it is for | Starting tier |
| --- | --- | --- |
| App Service Plan (Linux) | Runs the Next.js application | Basic B1, one instance |
| PostgreSQL Flexible Server | The database | Burstable, 2 vCore, 32–64 GiB storage |
| Key Vault | The database password, session signing secret, intake and schedule tokens, Entra client secret | Standard |
| Log Analytics + Application Insights | Knowing why it broke | Pay-as-you-go, 30-day retention |
| Logic Apps (two) | One calls the scheduled pass daily; one forwards mail into the intake endpoint | Consumption |
| Microsoft Entra ID | Sign-in for Axiocloud staff | Existing directory, free tier |

That is one environment. It is deliberately modest: the database holds a few hundred issues and
will hold a few thousand, and the traffic is a few dozen people using a planning tool during
working hours. Buying capacity for that workload is not where the money goes.

Two of those choices deserve a sentence each, because they are the ones most likely to be
questioned. **Basic B1** is the cheapest App Service tier that supports Always On, a custom
domain and a free managed certificate, which is the whole of what this application needs to run
properly; what it does not buy is deployment slots, so every release restarts the site and
interrupts anyone mid-edit, and there is no autoscale. The named upgrade is **P0v3**, which buys
both — and is the right step up rather than the traditional Standard S1, which costs more for
slower cores and less memory. Take the upgrade when the deploy interruption starts being
noticed, not in anticipation of it. **Burstable** is likewise the honest tier for a database
holding a few hundred rows; it is not a compromise at this size, and the reason to leave it is
high availability rather than performance.

### The range

| Shape | Indicative monthly total | What you get, and what you give up |
| --- | --- | --- |
| **Starting** | **USD 80 – 160** | The table above. One production environment, one instance, sensible logging. Adequate for the shakedown period described in section 7 and for internal use with no client-facing availability commitment. No deployment slots, no autoscale, no high availability. Networking features such as virtual-network integration and private endpoints gate on the App Service tier — confirm what Basic permits before relying on either. |
| **Recommended once a client depends on it** | **USD 200 – 400** | P0v3 with deployment slots so releases stop interrupting people, a larger database, longer log retention, and a second non-production environment or a staging slot. |
| **Hardened** | **USD 550 – 1,000** | Adds zone-redundant database high availability, private endpoints so the database is not reachable from the internet, and Front Door with a web application firewall in front. Appropriate when a contractual availability or security commitment exists, and wasted before then. |

A separate environment for staging or user acceptance testing adds roughly 60 to 80 per cent of
whichever figure above is chosen, and rather less if it is shut down outside working hours,
which is a scheduled task somebody has to write. A one-year reservation or savings plan on App
Service and database compute typically removes a substantial share of those two lines and is
worth revisiting once the shape has stopped changing — but not on day one, because a reservation
is a commitment to a SKU you may still want to change.

### Which lines are flat and which grow

**Flat.** The App Service plan and the database compute are the bulk of the bill and they cost
the same whether the application is used heavily or not at all — you are renting capacity, not
consumption. Key Vault is metered per operation and at this volume rounds to nothing. The two
Logic Apps on the Consumption plan are near-flat at this volume: a daily scheduled pass is about
thirty runs a month.

**Grows with use.** Database storage and its backup grow with the record count, and the
fastest-growing table will be the audit trail, because every change to every field writes a row
and nothing deletes them — a retention policy for audit data is a real decision, and it is a
contractual one before it is a technical one. Log Analytics ingestion is the line that surprises
people: it is billed per gigabyte ingested and again for retention beyond the included period,
and a verbose diagnostic setting turned on during an incident and forgotten is the single most
common way a small Azure bill doubles. Logic Apps grow with volume, and a mail-intake workflow
that polls a mailbox every few minutes costs meaningfully more than one triggered by a webhook.

**Not on the bill yet, but will be.** Blob Storage and its backup, the moment evidence file
upload is built. Egress bandwidth, which is negligible for this application. Entra ID licensing,
if the firm wants conditional access or multi-factor policies beyond what the free tier covers,
or if client users are ever invited into the workspace as guests — both are per-user charges and
both change the arithmetic more than any infrastructure line here.

---

## 6. The alternatives, fairly

### App Service against Container Apps

**Container Apps** is the more modern answer and has one genuine advantage for this workload:
it can scale to zero, so an application used during office hours costs nothing overnight. It
also brings revision-based deployment and finer-grained scaling. Against that, it requires
Axiocloud to own a Dockerfile, a container registry and a build pipeline, and to keep the base
image patched — which is a standing obligation on a team that does not have a platform
engineer. Scale-to-zero also means a cold start, and the first person to open a Gantt chart in
the morning pays for it.

**App Service** takes a Node application, a startup command and a deployment, and provides TLS,
a custom domain, a managed certificate, managed identity and health probing without any of them
being a project — and deployment slots at the tier above the starting one. Next.js on App
Service Linux is a well-trodden path. The application already exposes a health endpoint written
for exactly this: App Service polls it, and an instance whose database has gone away is taken
out of rotation rather than left serving errors.

**Recommendation: App Service.** The cost difference is small and could favour either. What
decides it is that App Service asks less of the people who will operate this, and the scarce
resource here is attention, not money. Container Apps becomes the right answer if Axiomate ever
grows a second deployable component.

### PostgreSQL Flexible Server against a container running Postgres

Running Postgres in a container alongside the application is cheaper on the invoice — perhaps
twenty-five to forty dollars a month cheaper — and that is the entire case for it.

What it costs you is everything the managed service does silently: automated backups with
point-in-time restore, minor-version patching, storage durability, TLS, integration with Entra
for database authentication, and the ability to answer "when was the last successful backup"
without going to look. A container's database lives on a volume that somebody must remember to
back up, restore drills that somebody must remember to run, and a patching cadence that nobody
owns. This database holds contracted values and billable hours. The question is not whether the
firm could operate a container database competently; it is whether, eighteen months from now,
the person who set it up still works here and the restore has ever been tested.

**Recommendation: Flexible Server.** The premium buys a documented recovery position, which is
the single most valuable thing to have when a client asks what happens if the system is lost.

### Azure against a machine under a desk

The machine under a desk is not a joke option and deserves a straight answer. It is nearly free
at the margin, it is fast, and the application currently runs that way.

What it cannot do is survive. There is no redundancy, the backup — if there is one — is on the
same machine or the same site, the address is a domestic or office broadband connection, patching
is whatever somebody remembers, and physical access is whoever is in the room. More to the
commercial point: **it cannot be put in front of a client.** A security questionnaire asks where
the data is hosted, what the recovery time objective is, who has administrative access and how
that access is reviewed. There is no set of answers to those questions that begins "on a
workstation in our office" and ends in a signed contract. The real cost of the machine under the
desk is not the risk of losing it; it is the engagements that cannot be quoted for while the
firm's delivery record lives there.

**Recommendation: Azure.** With one honest qualification. Keeping Axiomate local while it is an
internal tool used by a handful of people, with no client depending on it and no client data
commitment attached to it, is a defensible position and is where the product is today. The
moment it becomes the record a client is shown, or the record the firm invoices from, it has to
move. That threshold is closer than it looks, because section 2 shows the data is already
client-confidential regardless of who looks at it.

---

## 7. What hosting does not fix

The product has been validated against 51 end-to-end delivery scenarios. Twenty pass, twenty-one
pass only in part, four fail, four are not implemented, and two cannot be tested at all.
Seventeen of the shortfalls are rated as the highest priority. Infrastructure addresses none of
them. The most consequential, for anyone approving this spend:

**The database has never actually been used.** Nothing in this codebase has ever executed a read
or a write against a live PostgreSQL server. The schema validates, the client generates, the
mapping was exercised in memory, and every real database operation is type-checked only. The
direct consequence for this decision is that **the first Azure deployment is also the first time
the persistence layer runs at all**. Budget a shakedown period, run the migration against an
empty database and then against a seeded copy, and do not put a client engagement onto it on day
one. This is the single largest technical risk in the proposal and it is a schedule risk, not a
cost one.

**Two people editing the same thing produce two valid writes and the later one stands.** There is
no per-user conflict detection. Concurrency between write batches is handled at the database
level, so nothing is silently lost from a transaction, but nothing tells a user their colleague's
change has just been overwritten by theirs.

**The same write delivered twice is applied twice.** Requests carry no identity, so a client retry
after a network timeout can duplicate an operation. Hosting makes this more likely rather than
less, because a hosted application has a real network in front of it.

**There is no recovery path when the database becomes unreachable.** Writes are queued and
retried with backoff; when the retries are exhausted the queue halts and the user is asked to
reload. Hosting improves the first half of this — the health probe pulls an instance whose
database has gone away out of rotation, so a failure is contained rather than served — but it
does nothing about the second half, because nothing reconciles a diverged browser against stored
state, and that needs a conflict model the product does not have.

**Tenant isolation is scoped, not enforced.** Every table carries a tenant and every query names
one, checked by a script — but the guarantee would be row-level security in the database, and
that has not been built. Combined with section 3, this means the separation between Axiocloud's
data and any second firm's is a discipline the code follows rather than something the database
enforces, and the separation between OAPIL's data and SLG's does not exist at all.

**Whole capabilities are absent.** Timesheet submission and rejection are not implemented — hours
are recorded, but nothing gathers a week of them for approval. Weekly client reporting and
monthly governance reporting exports do not exist. Email and Teams notifications have nowhere to
be delivered to, so they are recorded as pending and stay that way. Nothing converts recorded
hours into money, because no rate exists anywhere in the model. Thirty-seven of the thirty-eight
registered agents are declarations with no implementation behind them.

**In fairness, hosting does unblock three things**, and they are worth naming because they are
part of what the spend buys. The scheduled pass is an endpoint waiting for something to call it,
and a Logic App timer makes the daily service-level check real for the first time. The intake
endpoint is a working pipeline waiting for a first mile, and a Logic App with a mailbox connector
supplies it — a forwarding rule and a token, not a build. And sign-in through Microsoft Entra ID
is already written: it activates when the app registration, client secret and redirect URI are
configured, which is a deployment step rather than a code change. That last one matters beyond
itself, because row-level security needs a database role per request, which needs identity — so
enforcing tenant isolation properly becomes possible only after this deployment happens, not
before.

*A note on the repository's own documentation:* the README and one entry in the internal defect
log still state that the application has no authentication. That was true and is no longer.
Sign-in through Entra ID exists in the code and activates on configuration. The stale text should
be corrected, but the paper's position is the code's position.

---

## 8. What has to be decided by a person

None of the following can be decided from inside the repository. Each needs a name against it
before provisioning starts.

**The subscription.** Which Azure subscription this lands in, whether it is an existing one or a
new one created for the purpose, who the billing owner is, and which cost centre carries it. A
new subscription is worth the small overhead here, because it makes the spend legible and makes
it possible to hand the whole thing to somebody else later.

**The region.** Per section 4: the answer follows from the client contracts, not from this
paper. Somebody has to read them, or confirm that no residency clause exists. The same decision
covers where backups are held, which is a separate choice and part of the same commitment.

**Who administers it.** A named platform administrator, and a second person who can get in when
the first is unavailable. One administrator is an outage; two undocumented administrators is a
different problem. This should be a role assignment somebody reviews, not a password somebody
remembers.

**Backup retention.** How many days of point-in-time restore (the practical choice is between
roughly a week and roughly a month), whether backups are geo-redundant, and — separately and
more consequentially — how long the audit trail and time records are kept. That second question
is driven by what client contracts and the firm's own record-keeping obligations require, and it
is the one that grows the bill over years rather than months.

**Who holds the Entra administrator role.** Specifically: who owns the app registration for
Axiomate, who may issue and rotate its client secret, who is entitled to the Administrator role
inside the application, and what the process is for granting and removing that. Related and
easily forgotten: whether client users will ever be invited into the workspace, which is both a
licensing question and, given section 3, a question about what they would be able to see.

Two more that are not on the brief's list but belong on it. **Who signs off the first production
restore test** — a backup nobody has restored is a belief, not a capability. And **who tells the
clients**, if their agreements require disclosure or consent before their data is processed by a
new sub-processor in a new country.
