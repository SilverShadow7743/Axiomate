# Browser verification checklist

*17 August 2026. Against `https://axiomate-tms.azurewebsites.net`, signed in as
sekharn@axiocloudsolutions.com.*

Ten features reached production today and yesterday without any of them being opened in a
browser. This is the list that closes that, in the order the dependencies actually run.

**Navigation below was read out of the components, not remembered.** Where a heading differs
from what you would expect — the milestone section is headed *Payment schedule*, not *Milestones*
— the real string is given.

---

## Before you start

Data was seeded so the screens have something on them
(`scripts/seed-verification-data.ts`, applied 17 Aug). What exists now:

| | |
|---|---|
| Skill catalogue | 18 entries, from your pricing model's own streams |
| Sample SOW | `SAMPLE-2.1`, **on the engagement named "Test"**, USD 295,000 / 2,860h |
| Milestones | 4, at 25/35/25/15. Number 1 is already **Delivered** |
| Change request | 1, **Submitted**, +160h / +USD 18,000 |
| Rates | Yours only — cost USD 95/hr, charge-out USD 160/hr |

**Not seeded, deliberately:** skill levels or rates for anybody else. Those are judgements about
named colleagues and somebody has to actually make them. Steps 3 and 4 are where you do.

The sample contract is on **Test**, never under OAPIL or SLG. Its figures are the worked example
from `Axiocloud_Pricing_Estimation_Model.xlsx`, which that workbook marks illustrative on its own
front page.

### Who else you need signed in

The seed ran as you, and the reducer refuses to let whoever raised a change decide it, or whoever
recorded a delivery accept it. That refusal **is** the thing to verify in 7c and 8c — but
completing them needs somebody else, and two different somebodies are needed overall:

| For | Who | Why |
|---|---|---|
| **7c, 8c** | **M Tarun Kumar** (kumart@axiocloudsolutions.com) | Made a second **Engagement Leader** on 18 Aug, so he holds `change.approve` and `milestone.accept`. Before that the firm had one engagement leader and every change request you raised was undecidable by anyone but an administrator |
| **10b, 10c** | Anyone *without* `config.manage` — **Amolak**, **Dharmendra**, **Jaya** or **Michael** all work | Those steps check that a restricted surface says so up front. Tarun no longer qualifies: Engagement Leader carries all 38 permissions |

---

## 1 · Sign in, and the gate

| | |
|---|---|
| **Do** | Open the site in a private window. |
| **Expect** | Redirect to `/signin`, a page with a Microsoft sign-in button, and **no workspace data in the page source**. Then sign in. |
| **Fault** | Any client name, issue subject or figure visible before you authenticate. |

---

## 2 · My work

New, 18 August. **`My work`** in the toolbar, left of `Configuration`, with a count on it.

**Expect** your work gathered from six places — decisions waiting on you, anything past its date,
anything blocked, your own unsubmitted hours, what is coming up, and the rest — grouped by *why*
each thing wants you, with the reason spelled out under each group heading.

> **There is deliberately no priority score.** If you see a number ranking rows, that is a fault.
> The order is: decisions first (they are the only rows holding up another person), then overdue,
> blocked, your hours, due, open. Oldest first inside each group.

Two things to check specifically:

- **A change or milestone you raised yourself must not appear.** The reducer would refuse your own
  decision on it, so offering the row would be a control that cannot succeed.
- **Clicking a row selects it in the tree and leaves the drawer open.** Working through eight items
  should not mean eight trips back to the toolbar.

---

## 3 · Row menu and inline status editing

These shipped first and have never been clicked.

**2a — the row menu.** Hover any row in the grid. A **`⋮`** appears at the right of the **name
column** — it is invisible until hover, selection or keyboard focus, which is by design. Click it.

- Expect: a menu with `Add …`, `Edit…`, `Move…`, and on issue rows also `Duplicate`, `Link…`,
  `Log time`, `Close…`, `Convert to …`, and `Archive…`/`Delete…` in red.
- Keyboard alternative: `Shift+F10` or the Context Menu key on a focused row.

**2b — inline status.** Double-click the **Status** cell of an issue row.

- Expect: a small dialog with a `Status` select, a `Why` box placeheld *"A short reason —
  required"*, and `Cancel` / `Save`.
- **Save must stay disabled** until the status has actually changed *and* a reason is typed.
  That is the check. `Escape` abandons.

---

## 3a · Skills

**Configuration** (top right of the toolbar) → left rail, **Operating model** → **Skills**.

**3a — the catalogue.** Expect 18 rows grouped by category, each with a `Retire` button.
Retire is **disabled** on any skill somebody is recorded against.

**3b — record your own.** In *Who can do what*, the `Who` select should already be you.
Choose a skill, a level, leave *Who says so* as **Self-rated**, set *Last used*, press `Record`.

**3c — record somebody else's.** Change `Who` to a colleague, set *Who says so* to **Assessed**,
fill *Assessed by*, press `Record`. You hold `skill.assess`, so this should work.

**3d — the duplicate refusal.** Record the same person against the same skill twice.

> **Expect a refusal:** *"… already has … recorded. Correct it rather than adding a second."*
> Then use the row's `Correct` button, which is what that message points at.

---

## 4 · Rates

**Configuration** → left rail, **Governance** → **Rates**.

> If the **Rates** tab is missing from the rail, that is a fault — but only for somebody without
> `rate.view`. You hold it. The tab is *absent rather than empty* by design, because an empty
> table would read as "no rates recorded" rather than "you may not see them".

**4a** — expect two rows for you: cost USD 95 and charge-out USD 160, both from 18 Feb.

**4b — the reason rule.** Add a rate and leave *Why* blank.

> **Expect a refusal:** *"A rate needs a reason — 'what changed and why' is the whole point of
> dating it."*

**4c — the overlap rule.** Record a second cost rate for yourself starting inside the first
period. Expect a refusal naming the clash.

---

## 5 · Capacity and leave

Select a **project** row — `Axio-Growth`, `D365 Implementation` — then the **Capacity** tab.
(Projects have no Overview tab; Capacity is the first one.)

**5a** — *Who is committed to this* lists allocations, each with `Release`.

**5b — the leave form.** Under **Time off and internal work**, the entry form takes `Who`,
`What` (Leave / Public holiday / Internal / Training), `From`, `To`, `Hours a day` (7.5 default)
and `Note`. Record one for yourself, then `Withdraw` it.

> This is the form the audit said did not exist — *"this is why Commitment has 0 rows"*.
> There are still **0 commitments** in production, so this is its first real use.

**5c** — *Working weeks* is **absent entirely** on a project with nobody allocated. That is
correct, not a rendering fault.

**5d** — *Can this be delivered?* shows Plan needs / Committed / Shortfall.

---

## 6 · Time and timesheets

Select an **issue** row → **Time** tab.

**6a — record time.** *Record time* section: `Who`, `Day` (cannot be in the future), `Hours`,
`Doing what`, `Billable`, `Note` → `Record`.

**6b — submit the week.** The week strip carries **`Submit week`**. It submits the week
containing the **date in the form above**, not necessarily this week — worth noticing.

> Absent (not greyed) without `time.submit`. You hold it.

**6c — the freeze.** After submitting, try to change an hour in that week.

> **Expect a refusal** saying the week is submitted and hours cannot change until it is approved
> or returned. This is the regression-risk step from the timesheets plan — a refusal in front of
> an arm that previously always succeeded.

**6d — approve or return.** `Approve` and `Return` appear only while the sheet is `Submitted`.
Returning demands a reason. **You submitted it, so the reducer will refuse your own approval** —
that refusal is the check.

---

## 7 · Commercial: SOW and changes

Select the **engagement** row named **Test** → **Overview** tab. There is no button and no
"Commercial" tab; the panel is simply there.

**7a** — *Statements of work* shows `SAMPLE-2.1`, Active, with Agreed / Planned / Spent / Left.

**7b** — *Changes* shows one **Submitted** change, +160h / +USD 18,000, marked
**· not in the total**. Confirm the contracted figure above it has **not** moved.

**7c — the self-decision refusal.**

> The seed raised it as you, so instead of `Approve` / `Refuse` you should see:
> *"You raised this — somebody else decides it."*
>
> **This is the check.** To complete the approval, have a second person with `change.approve`
> sign in. When they approve it, the contracted total should move from 2,860h to 3,020h and the
> sentence should read *"2,860h signed + 160h approved"*.

---

## 8 · Milestones — headed **Payment schedule**

Same panel, below Changes.

**8a** — four rows, 25/35/25/15, summing to 100%. Number 1 reads **Delivered / Pending** and
should be flagged as *delivered and awaiting acceptance* in the sentence above the table.

**8b — the schedule check.** `Edit` milestone 4 and change 15% to 5%.

> **Expect a report, not a refusal:** *"The milestones add up to 90% of the contract. 10% is not
> yet allocated to one."* It must still save — a firm typing four milestones passes through 25,
> 60 and 85 on the way to 100. Then set it back to 15.

**8c — the acceptance refusal.**

> Milestone 1 was delivered by you, so no `Accept` button should appear. Instead:
> *"You recorded this delivered — somebody else accepts it."*
>
> **This is the check.** With a second person holding `milestone.accept` (Engagement Leader or
> Client Sponsor), accepting it should freeze its value at USD 73,750 — 25% of 295,000 — and
> that figure must **not** move when the change request in 7c is later approved.

**8d** — an accepted milestone offers no `Edit` and no `Remove`. That is deliberate: the client
signed against that name and value.

---

## 9 · Documents — expected to refuse

Select an **issue** row → **Evidence** tab → **`Manage evidence`**.

**9a** — the drawer opens with *Source*, *Held by this app* and the evidence list.

**9b — attach a file.** Press `+ Attach files` and choose anything small.

> **Expect exactly this refusal:**
>
> *"No document library has been chosen. An administrator needs to grant this application the
> Files.ReadWrite.All application permission in Entra, then set AXIOMATE_DOCS_DRIVE_ID to the
> library's drive id."*
>
> **That message is a pass, not a fail.** It is pending action A6 and only you can clear it.
> Anything else — a silent failure, a generic error, or an apparent success — is a fault, because
> an upload that reports success and stores nothing is the exact failure the entity was built to
> prevent.

**9c** — after the consent is granted, repeat. The file should appear under *Held by this app*
with a working download, and `⤒` on an evidence row should attach a file to that description.

---

## 10 · Two defects, now fixed — worth confirming

Both were found by reading the code and both are fixed. These two steps check the fixes.

**10a — activity rows keep the parent's tabs.** Select an **activity** row (a phase under an
issue). Click `Time`, then `Evidence`, then `Estimation`.

> **Expect them to stay put** and show the parent issue's content. Before the fix, each click
> snapped straight back to `Overview` — the tab bar was built from the resolved parent issue while
> the guard was built from the row's own field, which an activity never has. Both now read one
> list, so they cannot disagree again.

**10b — Configuration says so up front.** This one needs somebody *without* `config.manage`.

> **Expect a banner** across the top of the Configuration workspace reading
> *"Read only. …"* with the reason. The button that opens it is deliberately still there:
> looking up what a work type or a service level means is useful to everybody, and the one
> genuinely sensitive section — Rates — is already absent from the rail without `rate.view`.

**10c — the evidence drawer disables rather than refuses.** Also needs a second, less-privileged
person. `+ Attach files`, `+ Link` and the per-item `✕` are now disabled with the reason in the
tooltip. Imported evidence has no `✕` at all — no grant makes it removable, so a permanently grey
button would only invite somebody to hunt for the permission that would ungrey it.

---

## Reporting back

For anything that fails, the useful three lines are: **which step**, **what you saw**, and
**the exact message**. The error strings above are quoted from the source, so a difference in
wording is itself a signal.
