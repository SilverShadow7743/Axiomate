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
recorded a delivery accept it. That refusal **is** the thing to verify in 8c and 9c — but
completing them needs somebody else, and two different somebodies are needed overall:

| For | Who | Why |
|---|---|---|
| **8c, 9c** | **M Tarun Kumar** (kumart@axiocloudsolutions.com) | Made a second **Engagement Leader** on 18 Aug, so he holds `change.approve` and `milestone.accept`. Before that the firm had one engagement leader and every change request you raised was undecidable by anyone but an administrator |
| **11b, 11c** | Anyone *without* `config.manage` — **Amolak**, **Dharmendra**, **Jaya** or **Michael** all work | Those steps check that a restricted surface says so up front. Tarun no longer qualifies: Engagement Leader carries all 38 permissions |

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

**2a — the list.** Expect your work gathered from six places — decisions waiting on you, anything past its date,
anything blocked, your own unsubmitted hours, what is coming up, and the rest — grouped by *why*
each thing wants you, with the reason spelled out under each group heading.

> **The rank is three parts, and all three should be visible.** Reason first — decisions are the
> only rows holding up another person — then **severity**, then age. So a High issue three days
> late must sort above a Medium one ten days late, and each row shows its severity and its date.
> If you see a bare number ranking rows, that is a fault; if you see High sorting below Medium
> inside a group, that is also a fault.

**2b — two things to check specifically.**

- **A change or milestone you raised yourself must not appear.** The reducer would refuse your own
  decision on it, so offering the row would be a control that cannot succeed.
- **Clicking a row selects it in the tree and leaves the drawer open.** Working through eight items
  should not mean eight trips back to the toolbar.

---

## 3 · Row menu and inline status editing

These shipped first and have never been clicked.

**3a — the row menu.** Hover any row in the grid. A **`⋮`** appears at the right of the **name
column** — it is invisible until hover, selection or keyboard focus, which is by design. Click it.

- Expect: a menu with `Add …`, `Edit…`, `Move…`, and on issue rows also `Duplicate`, `Link…`,
  `Log time`, `Close…`, `Convert to …`, and `Archive…`/`Delete…` in red.
- Keyboard alternative: `Shift+F10` or the Context Menu key on a focused row.

**3b — inline status.** Double-click the **Status** cell of an issue row.

- Expect: a small dialog with a `Status` select, a `Why` box placeheld *"A short reason —
  required"*, and `Cancel` / `Save`.
- **Save must stay disabled** until the status has actually changed *and* a reason is typed.
  That is the check. `Escape` abandons.

---

## 4 · Skills

**Configuration** (top right of the toolbar) → left rail, **Operating model** → **Skills**.

**4a — the catalogue.** Expect 18 rows grouped by category, each with a `Retire` button.
Retire is **disabled** on any skill somebody is recorded against.

**4b — record your own.** In *Who can do what*, the `Who` select should already be you.
Choose a skill, a level, leave *Who says so* as **Self-rated**, set *Last used*, press `Record`.

**4c — record somebody else's.** Change `Who` to a colleague, set *Who says so* to **Assessed**,
fill *Assessed by*, press `Record`. You hold `skill.assess`, so this should work.

**4d — the duplicate refusal.** Record the same person against the same skill twice.

> **Expect a refusal:** *"… already has … recorded. Correct it rather than adding a second."*
> Then use the row's `Correct` button, which is what that message points at.

---

## 5 · Rates

**Configuration** → left rail, **Governance** → **Rates**.

> If the **Rates** tab is missing from the rail, that is a fault — but only for somebody without
> `rate.view`. You hold it. The tab is *absent rather than empty* by design, because an empty
> table would read as "no rates recorded" rather than "you may not see them".

**5a** — expect two rows for you: cost USD 95 and charge-out USD 160, both from 18 Feb.

**5b — the reason rule.** Add a rate and leave *Why* blank.

> **Expect a refusal:** *"A rate needs a reason — 'what changed and why' is the whole point of
> dating it."*

**5c — the overlap rule.** Record a second cost rate for yourself starting inside the first
period. Expect a refusal naming the clash.

---

## 6 · Capacity and leave

Select a **project** row — `Axio-Growth`, `D365 Implementation` — then the **Capacity** tab.
(Projects have no Overview tab; Capacity is the first one.)

**6a** — *Who is committed to this* lists allocations, each with `Release`.

**6b — the leave form.** Under **Time off and internal work**, the entry form takes `Who`,
`What` (Leave / Public holiday / Internal / Training), `From`, `To`, `Hours a day` (7.5 default)
and `Note`. Record one for yourself, then `Withdraw` it.

> This is the form the audit said did not exist — *"this is why Commitment has 0 rows"*.
> There are still **0 commitments** in production, so this is its first real use.

**6c** — *Working weeks* is **absent entirely** on a project with nobody allocated. That is
correct, not a rendering fault.

**6d** — *Can this be delivered?* shows Plan needs / Committed / Shortfall.

---

## 7 · Time and timesheets

Select an **issue** row → **Time** tab.

**7a — record time.** *Record time* section: `Who`, `Day` (cannot be in the future), `Hours`,
`Doing what`, `Billable`, `Note` → `Record`.

**7b — submit the week.** The week strip carries **`Submit week`**. It submits the week
containing the **date in the form above**, not necessarily this week — worth noticing.

> Absent (not greyed) without `time.submit`. You hold it.

**7c — the freeze.** After submitting, try to change an hour in that week.

> **Expect a refusal** saying the week is submitted and hours cannot change until it is approved
> or returned. This is the regression-risk step from the timesheets plan — a refusal in front of
> an arm that previously always succeeded.

**7d — approve or return.** `Approve` and `Return` appear only while the sheet is `Submitted`.
Returning demands a reason. **You submitted it, so the reducer will refuse your own approval** —
that refusal is the check.

---

## 8 · Commercial: SOW and changes

Select the **engagement** row named **Test** → **Overview** tab. There is no button and no
"Commercial" tab; the panel is simply there.

**8a** — *Statements of work* shows `SAMPLE-2.1`, Active, with Agreed / Planned / Spent / Left.

**8b** — *Changes* shows one **Submitted** change, +160h / +USD 18,000, marked
**· not in the total**. Confirm the contracted figure above it has **not** moved.

**8c — the self-decision refusal.**

> The seed raised it as you, so instead of `Approve` / `Refuse` you should see:
> *"You raised this — somebody else decides it."*
>
> **This is the check.** To complete the approval, have a second person with `change.approve`
> sign in. When they approve it, the contracted total should move from 2,860h to 3,020h and the
> sentence should read *"2,860h signed + 160h approved"*.

---

## 9 · Milestones — headed **Payment schedule**

Same panel, below Changes.

**9a** — four rows, 25/35/25/15, summing to 100%. Number 1 reads **Delivered / Pending** and
should be flagged as *delivered and awaiting acceptance* in the sentence above the table.

**9b — the schedule check.** `Edit` milestone 4 and change 15% to 5%.

> **Expect a report, not a refusal:** *"The milestones add up to 90% of the contract. 10% is not
> yet allocated to one."* It must still save — a firm typing four milestones passes through 25,
> 60 and 85 on the way to 100. Then set it back to 15.

**9c — the acceptance refusal.**

> Milestone 1 was delivered by you, so no `Accept` button should appear. Instead:
> *"You recorded this delivered — somebody else accepts it."*
>
> **This is the check.** With a second person holding `milestone.accept` (Engagement Leader or
> Client Sponsor), accepting it should freeze its value at USD 73,750 — 25% of 295,000 — and
> that figure must **not** move when the change request in 8c is later approved.

**9d** — an accepted milestone offers no `Edit` and no `Remove`. That is deliberate: the client
signed against that name and value.

---

## 10 · Documents — expected to refuse

Select an **issue** row → **Evidence** tab → **`Manage evidence`**.

**10a** — the drawer opens with *Source*, *Held by this app* and the evidence list.

**10b — attach a file.** Press `+ Attach files` and choose anything small.

> **Expect exactly this refusal:**
>
> *"No document library has been chosen. An administrator needs to grant this application the
> Files.ReadWrite.All application permission in Entra, then set AXIOMATE_DOCS_DRIVE_ID to the
> library's drive id."*
>
> **That message is a pass, not a fail.** It is pending action A6 and only you can clear it.
>
> One correction to it, not yet reflected in the string: the permission actually being granted is
> **`Sites.Selected`**, not `Files.ReadWrite.All`. `Sites.Selected` grants access to nothing until
> the application is granted on one named site; `Files.ReadWrite.All` would have given it every
> file in every site and OneDrive in the tenant. The site is
> `axiocloudsolutions.sharepoint.com/sites/axiomate-documents`, created 18 August 2026.
> Anything else — a silent failure, a generic error, or an apparent success — is a fault, because
> an upload that reports success and stores nothing is the exact failure the entity was built to
> prevent.

**10c** — after the consent is granted, repeat. The file should appear under *Held by this app*
with a working download, and `⤒` on an evidence row should attach a file to that description.

---

## 11 · Portfolio — every engagement at once

**Portfolio** in the toolbar, left of *My work*.

**11a — the list.** One line per engagement, ordered by what most wants attention.

> **Expect** each line to state what is wrong as **counted claims** — "13 blocked, 15 with no
> owner" — and an engagement with nothing wrong to say so in words.
>
> **Fault:** any percentage, any RAG light, any single blended number. Each figure must resolve
> to rows you can open and disagree with. A score is an argument about weights nobody can see.

**11b — nothing is counted twice.** Expand the tree beside it. `OAPIL Engagement` contains the
project `D365 Implementation`.

> **Expect one line, named for the engagement**, carrying the project's issues in its figures and
> saying "1 project inside". The first version of this listed both tiers and reported every
> engagement twice with doubled totals; it is the fault most likely to come back.

**11c — the footer admits what it misses.** Work filed above the engagement tier is in no line.
The footer says so. The 29 issues under *Unfiled intake* are that number.

---

## 12 · Capabilities — what this workspace can do

**Configuration** → **Capabilities**.

**12a — every row reports two different things.** *Off* is a decision somebody made.
*Unreachable* means no role holds the permissions it needs.

> **Expect 19 rows, all showing a role count.** None should read *unreachable*.
>
> **Fault:** the two states merged into one indicator. "Off" and "nobody can use this" look
> identical from outside and want completely different responses. Five permissions were once in
> exactly the second state in production and nothing anywhere said so.

**12b — it is an inventory, not a control panel.** There are no switches here; rows name where
the switch lives (*"Switched at Configuration → Where documents are filed"*). Two places to change
one thing is how they come to disagree.

---

## 13 · Goals — and the box that is deliberately missing

**Configuration** → **Goals**.

**13a — set one.** Name it, choose a part of the tree, pick a measure, give it a target and a date.

> **Expect** the figure to appear immediately, computed from the register.
>
> **Fault, and the one that matters most on this screen: any field to enter progress into.**
> There is none and there must never be one. A number somebody types about their own work drifts
> in one direction, and a goal reading 80% for a month is the normal state of every other tool's
> version of this.

**13b — ceilings and targets are not one shape.** Set both a *Work closed* goal (a target to
reach) and an *Open work held under* goal (a ceiling to stay below).

> **Expect no percentage on either.** 40% of a ceiling is healthy; 40% of a target is behind, and
> one number that flips meaning between two rows is worse than none.

**13c — an unmeetable goal is refused, and says which way it is unmeetable.** Try a window that
starts after the date it is judged on.

> **Expect** *"The window starts after the date it is judged on, so nothing could ever count."*
> Six such refusals exist, each with its own sentence. All six would otherwise render as a goal
> sitting at zero — which reads as failing rather than as misconfigured.

---

## 14 · Two defects, now fixed — worth confirming

Both were found by reading the code and both are fixed. These two steps check the fixes.

**14a — activity rows keep the parent's tabs.** Select an **activity** row (a phase under an
issue). Click `Time`, then `Evidence`, then `Estimation`.

> **Expect them to stay put** and show the parent issue's content. Before the fix, each click
> snapped straight back to `Overview` — the tab bar was built from the resolved parent issue while
> the guard was built from the row's own field, which an activity never has. Both now read one
> list, so they cannot disagree again.

**14b — Configuration says so up front.** This one needs somebody *without* `config.manage`.

> **Expect a banner** across the top of the Configuration workspace reading
> *"Read only. …"* with the reason. The button that opens it is deliberately still there:
> looking up what a work type or a service level means is useful to everybody, and the one
> genuinely sensitive section — Rates — is already absent from the rail without `rate.view`.

**14c — the evidence drawer disables rather than refuses.** Also needs a second, less-privileged
person. `+ Attach files`, `+ Link` and the per-item `✕` are now disabled with the reason in the
tooltip. Imported evidence has no `✕` at all — no grant makes it removable, so a permanently grey
button would only invite somebody to hunt for the permission that would ungrey it.

---

## 15 · The Board — a drag with the same ceremony as the form

Open the workspace, click **Board** in the view switcher (beside the zoom buttons — which
should disappear, since there is no timeline to zoom).

1. Every configured status is a lane, empty ones included. The header sentence states the
   total and says a drag asks the same transition rules as the grid.
2. Drag any **Open** card onto **Awaiting client confirmation**. It must refuse at the lane:
   *"Open" cannot move straight to "Awaiting client confirmation"* — the policy's own words,
   listing where the work may go instead.
3. Drag an Open card onto **In Progress** (legal). A strip appears asking for a reason, and
   **Move it** stays disabled until one is typed. Cancel leaves everything unchanged.
4. Drag a card without evidence onto **Closed - confirmed** (from Awaiting). It must refuse
   naming evidence — a drop cannot conjure evidence, so there is no dialog to nowhere.
5. Complete a legal move with a reason, then open History on that record: the change is there
   with the reason, identical to one made through the grid.

## 16 · The Calendar — and what it admits it cannot show

Click **Calendar** in the switcher.

1. The header sentence states the split — how many scheduled items fall in this month, and how
   many records carry no planned date. **This number is larger than the toolbar's `unscheduled`
   count, and both are right**: the toolbar counts the health label, and `computeHealth` gives
   Blocked precedence over Unscheduled (lib/schedule.ts:70-71), so a blocked record with no date
   is in the calendar's figure but not the toolbar's. The check that must hold is the calendar's
   own: dated + undated = every record shown. On 19 Aug 2026 that was 1 + 137 = 138, beside a
   toolbar reading of 124 unscheduled + 14 blocked.
2. The **Unscheduled** rail lists those records; clicking one opens the detail panel.
3. Click a day: the rail switches to that day's items. Click it again to return.
4. ‹ / Today / › move months; nothing ever renders on a padding day from an adjacent month.
5. Nothing on this view edits anything — that is v1 as designed, not a gap.

## 17 · Recurring work — the rule, the raise, and the guard

Open **Configuration → Recurring work** (under Automation).

1. Add a weekly rule due today against a real engagement — pick today's weekday. The card
   appears saying "Never raised yet."
2. Run the pass by hand: POST `/api/schedule/run` signed in (or with the schedule token). The
   response's `recurrences` names the rule, the occurrence, and the new issue id.
3. Find the issue in the tree: subject is the rule's name stamped with the occurrence date,
   status Open, owner as configured (or Unassigned), History attributed to **Scheduled pass**.
4. POST the pass again. `recurrences` is empty — the same occurrence is never raised twice —
   and the rule's card now says what it last raised for.
5. The card's last-raised date has nowhere to be edited. That is a record of what happened,
   not a setting.
6. Try adding a rule that files under the company root: the form only offers scopes an issue
   may live under, and the reducer refuses anything else with the message naming the kind.

## What has actually been opened in a browser

Recorded because the distinction turned out to matter more than anything else in this document.
On 18 August 2026 three faults were found by opening screens, and **none of them was visible to
`tsc`, to the build, or to 73 passing scenarios**:

| Fault | Why nothing else could see it |
|---|---|
| The detail form refused a closure naming a reason field it had no box for | The rule was proven; no scenario drives a React component |
| My work and Portfolio summaries cut off mid-word | The text was in the DOM; nothing failed |
| Capabilities and Goals descriptions cut off mid-word | Same cause, a second single-line class |

Sections **1, 11, 12, 13, 14a, 15 and 16** have been driven end to end against production.
On 19 Aug 2026 the board's three drop outcomes were exercised live: the illegal move refused in
the policy's words, a legal move collected its reason and landed in History identically to a
grid edit, and the record was moved back the same way. 15.4 (evidence refusal) could not be
browser-driven — no live record sits in Awaiting — and stays covered by scenario BV1 through
the real reducer.

One note for whoever automates this next: **a synthetic CDP mouse-drag on a `draggable` element
freezes the Chromium renderer** — native drag-and-drop enters a nested event loop that the
synthetic release never exits. A person dragging with a real mouse is unaffected. Automation
must dispatch `DragEvent`s from page JavaScript instead, which is how 15.2–15.5 were driven. The rest have
been read and reasoned about but not clicked. That gap is where the three faults were.

---

## Reporting back

For anything that fails, the useful three lines are: **which step**, **what you saw**, and
**the exact message**. The error strings above are quoted from the source, so a difference in
wording is itself a signal.
