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

## 18 · Request forms — capture without disclosure

Open **Configuration → Routing & intake → Request forms**.

1. Add a form named "OAPIL request form" filing under OAPIL Engagement. Its card shows the
   full URL with the minted token, badge "accepting".
2. Open that URL in a **private window, signed out**. The form renders: name, email, subject,
   description, urgency. View the page source: no workspace names, counts or vocabulary
   anywhere in it.
3. Change one character of the token in the address bar and reload: the page still renders the
   same form — it must not answer whether a token is real. Submit through it: the refusal is
   one sentence, identical to what a disabled form would say.
4. Back on the real URL, submit a genuine test entry with urgency "Urgent — work is stopped".
   The page answers "Received — reference OAPIL-nnn".
5. Signed in, find that reference: filed under OAPIL Engagement, severity High with confidence
   stated, raisedBy carrying the claimed name and email, and a pinned note naming the form.
6. Switch the form off, submit again from the private window: the same one-sentence refusal as
   step 3. Expected, not a bug: two identical submissions while enabled create two records —
   a form has no sender message id.

## 19 · Blueprints — the shape of what ran, stored for what's next

Open **Configuration → Blueprints** (under Governance).

1. Choose OAPIL Engagement as the source and press **Propose**. The sentence states how many
   entries were found, how many are dated, and the anchor date — or says plainly that nothing
   carries a planned date and everything will apply undated.
2. Untick a structural tier: its children must drop out of the count on the Store button.
   Untick the client-specific history; keep the repeatable shape.
3. Name it "D365 implementation v1" and store. The card appears at v1, "applied never",
   with the entry/offset/dependency counts.
4. Rename it (edit via a fresh store is fine): still v1. Only a change to entries or links
   moves the version — provenance must never point at versions nobody authored.
5. **Do not apply it today.** Applying creates a real engagement; the apply half of this
   section runs the day a real one starts: choose the target and anchor, read the button —
   it states the exact count it will create — apply, then check the card records
   "Applied v1 to X on date by name" and the built subtree carries dates computed from the
   anchor with undated items still undated.

## 20 · Client mail — the outward door, proven shut before it opens

The only feature in this application that writes OUTWARD. Every step before the send proves a
refusal; the send itself is one message, to the operator's own address, followed back in.

1. **Before anything is granted**: open **Configuration → Capabilities**. "Client mail" must
   show unreachable with `lostInMerge` naming `mail.send` — the stored roles predate the key,
   and this screen existing is why that is an observation rather than a mystery. (`note.add`
   is also required but the delivery roles already hold it.)
2. On **Configuration → Permissions**, grant "Write to clients" to the operator's role.
   Capabilities now shows Client mail reachable.
3. Open an issue with **no email in Raised by** (any internal record): the Reply to client
   section shows the no-recipient sentence and no compose. Open one whose Raised by is a bare
   display name: same. The section must never show a Send button it would refuse.
4. Open **OAPIL-146** (raisedBy carries a claimed address). The compose shows From = the
   OAPIL intake mailbox, To = the claimed address, Subject = `RE: … [OAPIL-146]` — all
   read-only. Sign in as somebody without the grant (or revoke it): the section is absent
   entirely, and a direct `POST /api/mail/send` refuses 403 in the gate's own words.
5. **The policy proof, before any send** — `Test-ApplicationAccessPolicy` for the app against
   `OAPILCatalyst@` must say **Granted**, and against any other mailbox must say **Denied**.
   The Denied half is the point: without it, app-only Mail.Send is send-as-anyone.
6. Type a short message **to the operator's own address** (edit the test record's raisedBy to
   claim it first). Send. Success closes the compose; the pinned **Client Communication**
   note appears on the Notes tab without a reload, carrying recipient, subject and body, and
   attributed to the person — not to any machine.
7. The message arrives in the operator's inbox **from `OAPILCatalyst@`**, subject carrying
   `[OAPIL-146]`. Check the shared mailbox's Sent Items holds it too.
8. **Reply to that email.** Within the watcher's three minutes, intake files the reply against
   OAPIL — the reference in the subject is what threads it — and the loop is closed: out from
   the record, back to the record.
9. Restore whatever the test bent: the record's raisedBy claim, and the test grant if it was
   made on a role that should not keep it.

## 21 · Proofing — the review that stays with the bytes it judged

Needs the document store live first: `AXIOMATE_DOCS_DRIVE_ID` must be set on the app
(pending-actions A6), or step 3 refuses with the sentence naming it. Needs a second signed-in
account (Tarun) for steps 5–6.

1. **Before anything is granted**: Configuration → Capabilities shows "Proofing" unreachable
   with `lostInMerge` naming `document.review`. Grant "Review deliverables" on Permissions to
   the operator's role and to Tarun's; the capability turns reachable.
2. Open an issue → Links → Manage evidence. The drawer's "Held by this app" list shows each
   stored file with **unreviewed** and the new controls.
3. Upload a small PDF. Ask for review: the picker does not offer yourself; name Tarun and a
   question. The chip reads **awaiting 1 of 1**.
4. As the asker, confirm no Approve/Request-changes buttons render for you — and that a
   direct `decideDocumentReview` POST refuses with the asker-cannot-decide sentence.
5. **As Tarun**: Request changes with an empty note is refused in the arm's words; with a
   note it lands, chip **changes requested**. Approve afterwards: the verdict REPLACES —
   chip **approved**, and a pinned Decision note naming the file appears in Notes.
6. **New version**: upload a changed file through the row's button. The list still shows one
   row (v2), the chip now reads **approved — an earlier version** (dashed), and v1 stays
   downloadable through the chain.
7. Withdraw a fresh review as its asker: chip **review withdrawn**; recorded verdicts stay
   visible in the audit trail.

## 22 · Identity ids — the rename that cannot orphan

Driven 22 Aug 2026. The persistence proof drives the full counter-case against Postgres (a
person created, hours and ownership recorded with their id, renamed in one field edit, and
their My Work still whole). In the live workspace after deploy and backfill: My Work
populated correctly under the id-first joins (32 items), and a spot check on SLG-037 showed
`owner "Nishant Sekhar" → ownerId PERSON_8` — the same entry the session joins by email.
Remaining null ids are compounds from the imported log and placeholders, on the name
fallback by design. The backfill script re-run reports zero remaining unique matches.

## 23 · Client boundary — what a client seat receives was decided per record

1. **Grant the key first.** Permissions screen → grant “See internal records”
   (`internal.view`) to every internal role that should keep its full view. Until the grant
   lands, non-admin internal users see the boundary-limited view — that is the fail-safe
   working, not an outage; ADMIN's ALL covers the operator from the first deploy. The grant
   screen must REFUSE the key on the three shipped client roles, in words ending “the client
   boundary is the point.”
2. **Mark one record.** Open an OAPIL record → Overview shows the `Internal` chip → “Show to
   client” flips it to `Client-visible`, audited as an ordinary field edit in History.
3. **Mark one note.** On the same record's Notes tab, add a note with “Show to client”
   ticked — the chip appears on the entry; a second note without the tick stays chipless.
   The per-note “Show to client / Make internal” button flips an existing note.
4. **Mark one file.** Evidence panel → a stored file's “Show to client” flips its chip;
   documents have no other update, so this is the one genuinely new arm
   (`setDocumentVisibility`, gated by `document.upload`).
5. **Prove the payload, not the screen.** As a reader without `internal.view` (a role-less
   probe), the served workspace contains ONLY: marked records with their ancestor chain,
   marked notes and files on surviving records, and audit entries about surviving records —
   with every audit entry about notes, evidence or documents dropped whole (they carry child
   content the entry cannot attribute). Rates, time, estimates, allocations, SoWs,
   notifications and the rest of the machinery are empty maps. The persistence proof's
   payload case (49/49) reads the serialized string for exactly this; the browser step
   confirms the same boundary on the live deployment.

**Driven 22 Aug 2026 (steps 1–3).** The fail-safe was seen working first: on deploy, before
any grant, Nishant's own seat received the boundary-limited view — 0 issues in a workspace of
251 — which is the design refusing to leak rather than an outage. The grant then landed on
all seven internal roles from the Permissions grid; ticking the key on Client User was
refused live in the designed words ("…the client boundary is the point"). OAPIL-146 was
marked from the Overview toggle and a note born visible from the composer checkbox — both
chips render, both stored (confirmed by reload from Postgres). The drive caught a real
defect the suite could not: `updateIssue`'s WIRE shape lacked `clientVisible` (CB1 drives
the reducer directly and passed), so the toggle sat at "Not saved" until commit 828f975
widened the patch whitelist — the queue's actions then arrived via the unload beacon and
applied cleanly. Step 4 (document toggle) waits on the same `AXIOMATE_DOCS_DRIVE_ID` app
setting as section 21 step 3 — no live record holds a stored file yet. Step 5's live half
(a signed-in reader without the key) waits on a client-role account; the serialized-payload
proof covers it meanwhile.

## 24 · Time grace — the late entry explains itself

1. **Set the allowance.** Configuration → Time recording → set the backdating allowance
   (calendar days, 0–60; refused outside that range in words). The shipped default is 7.
2. **Record inside it.** On a record's Time tab, an entry dated within the allowance records
   with no reason asked — the ordinary act stays ordinary.
3. **Record past it.** Date the entry beyond the allowance: the form shows the lateness and
   a "Why so late" box, and Record stays disabled until it is filled — the arm refuses the
   same entry sent bare, naming both numbers ("Recorded N days after… the allowance is M").
   With a reason, it records; the entry wears "late — <reason>" in the table and the audit
   row carries "N days late".
4. **Correct a stale entry.** Changing the HOURS of an entry past the allowance asks for a
   reason the same way; relabelling its note or billing asks nothing.
5. **The approver reads the reasons.** Submit the week; the decider's strip lists the week's
   late entries with their reasons above Approve — that reading is where the rule's "second
   person" requirement is discharged.
6. **Watch the pill.** Every step above must reach "Up to date" — the wire shape and the
   reducer widened together this time (the section-23 lesson).

**Driven 22 Aug 2026 (steps 1–3, 6).** The card set the allowance to 5 and said so in a
toast; on OAPIL-034 (open, raised 30 Jul) an entry dated 14 Aug surfaced the "Why so late"
box — "8 days after the work — the allowance is 5" — with Record disabled until the reason
was filled, then recorded wearing "late — <reason>", accepted by the server on the first
try (the wire widened with the reducer this time). Two incidental findings: (a) the FIRST
attempt targeted OAPIL-146 and was refused by the *before-window* rule — its 19 Aug raise
date makes any late-enough entry predate the record — which is the window and the grace
gate composing correctly; (b) the automation driving this test double-executed the Record
click a minute apart (a frozen-renderer CDP retry), producing two entries under two
idempotency keys — each honestly recorded, both withdrawn through Remove with the trail
kept, and no app defect: a person's form clears synchronously on success, so a human
double-click records once. Test data was cleaned up and the allowance restored to the
shipped 7. Steps 4–5 (stale correction, approver's reading) are proven by TG1 and the
suite; their browser half waits for a real submitted week.

## 25 · Allocation cap — nobody past capacity, unless the firm says otherwise

1. **The card reads hard on first load.** Configuration → Allocation shows the two modes in
   words with Hard selected — the merged default on a stored model that predates the key.
2. **The refusal, with no way past it.** On Capacity (or a project's people panel), commit
   somebody to more than they have: refused with the arithmetic AND the policy —
   "…enforces the allocation cap — free up the person, shorten the window, or lower the
   share." No "Commit anyway" appears anywhere; the form keeps its values.
3. **Advisory restores the recorded two-step.** Set Advisory on the card; the same
   commitment warns, "Commit anyway" appears, and accepting it lands in History as
   "Deliberately overallocated" with the numbers.
4. **Hard again shuts the door.** Back on the card, Hard; the same override is refused.
   Both mode changes sit in the audit trail. Release any test allocation.
5. **The judgement never moved.** A single allocation over 100% refuses identically in
   both modes — that bound was never the policy's to change.

## 26 · Notification preferences — the person's own say over each kind

1. **The block, in your own inbox.** The bell → Preferences… shows three rows in words
   ("When work is assigned to me…"), each on "tell me here" — the default, which is exactly
   yesterday's behaviour. The intake row shows only if you hold "Assign work"; the email
   choice warns when the directory holds no address for you.
2. **Email me my assignments.** Set "also email me" on the first row; have somebody assign
   you a record. Two notifications exist: the in-app one in your bell, and an email one
   `pending` — "Queued for the scheduled pass to email." The next pass run sends and stamps
   it.
3. **Mute intake.** "Don't tell me" on the intake row; a new request arriving through the
   door mints nothing for you — and the record's History still carries the notification
   line marked "(muted by their preference)", so "why didn't I get this" has a stored
   answer.
4. **Only yours.** Another signed-in person setting *your* preferences is refused in words
   ("Preferences are the person's own…") unless they hold "Configure the platform".
5. **The pill.** Every change reaches "Up to date" — the four wire registration points
   landed together, and the preference survives a reload because `setNotificationPref` is
   the one non-config action that writes the model document.

## 27 · The week grid and the approvals queue

1. **The button.** The toolbar's Timesheets button opens the panel; its badge counts
   submitted weeks awaiting a decision, and shows only to holders of "Approve time".
2. **The gathering.** My week shows one row per record with hours that week, day columns,
   totals both ways; ‹ › moves weeks. A row click lands on that record's Time tab — the
   grid gathers, it never edits.
3. **The attestation.** Submit week from the panel, gated by the same rule as the Time tab;
   the status line says submitted/approved/returned in the same words.
4. **The queue.** For an approver: every submitted week — person, label, totals, and the
   week's late entries with their justifications, read before deciding. Approve and Return
   (reason required) per row.
5. **Approve all, minus your own.** The batch button counts only what `decideProblem`
   allows — the approver's own submitted week is excluded with a note, because the batch is
   atomic and one self-approval would abort every approval in it.

## 28 · Override provenance — who decided each value, and what a change reaches

1. **Effective here.** Configuration → Scope overrides → pick an engagement: every term,
   live agent and responsibility shows its resolved value and a chip — `set here`,
   `from <scope>`, `organisation default`, or `shipped default`.
2. **The radius on a local override.** A row in "What this scope changes" says what it
   reaches — "reaches N scopes · M set their own (<names>) and will not move."
3. **The preview before the save.** On Terminology at a scope, typing into a term shows
   the same reach line before the save commits anything.
4. **The chips agree with the walk.** Set a term at the organisation, override it at an
   engagement: the engagement chips `set here`, a process area beneath it chips
   `from <engagement>`, a sibling client chips `organisation default`.

## 29 · Mentions — naming a colleague tells them

1. **The ping.** On a record's Notes tab, write a note naming a directory person with
   `@Their Name`. The name renders highlighted, and one notification lands in their bell —
   "You were mentioned on <record>" — however many times the note repeats the name.
2. **Never the author.** Naming yourself pings nobody.
3. **Only the newly named.** Edit the note to add a second name: only the addition is
   pinged; the kept name is not re-pinged.
4. **The preference.** The Inbox preferences row "When somebody mentions me" — mute turns
   the ping into the History line "(muted by their preference)"; "also email me" queues
   the email record for the scheduled pass.
5. **Unknown tokens stay text.** `@Nobody` matching no directory person renders plain and
   mints nothing — the parser refuses to guess.

## 30 · Risks and decisions — the judgement and the outcome, first-class

1. **The types are there.** Configuration → Work types shows Risk and Decision among the
   registry (not from the source log); a new record can be created or retyped as either.
2. **Judging a risk.** On a Risk-typed record's Overview, the Exposure row: pick
   Likelihood and Impact (1–5) — the product and band compute beside them
   ("= 20 · Critical"); clearing a half reads "not yet judged — exposure is computed,
   never stored". Out-of-range values cannot be sent; the reducer refuses them in words.
3. **Recording a decision.** On a Decision-typed record, Edit → Outcome — the sentence
   people ask for months later; emptied, it stores null and reads "no outcome recorded
   yet".
4. **The rename survives.** Rename the Risk work type to "Threat" on Work types: the
   Exposure row stays on Threat-typed records — the semantics ride the stable id.

## 31 · The accessibility gate — and the walk it cannot do

1. **The gate.** `npm run audit:a11y` exits 0. It runs beside the other audits on every
   sweep; a new structural violation (a click with no keyboard path, a control with no
   name, misused ARIA) fails it loudly. Its first honest count was 46, cleared in ef1090f.
2. **What a reasoned disable means.** Every `eslint-disable` in the components names the
   rule AND the keyboard path that justifies it in place — a bare `off` is forbidden by the
   design.
3. **The manual keyboard walk** (what a static gate cannot see):
   - Tab into the tree: the grid takes focus; arrows move; sortable headers take focus and
     sort on Enter/Space.
   - Open any modal (Archive, Timesheets, a dialog): focus moves in, Tab wraps inside,
     Escape closes, focus returns to where it was — the useOverlay contract.
   - The Inbox and its Preferences rows are reachable and operable by keyboard.
   - Spot-check contrast on the chips (cv-chip, cfg-chip, raid bands) in both themes.

**Sections 25–31 driven 23 Aug 2026, one pass, after the Chrome extension reconnected:**
§25 — the Allocation card reads Hard on first load (the merged default), both modes in the
designed words; the refusal flow itself stays covered by AC1. §26 — all four preference
rows render in the bell with the current mode marked; "also email me" set on mentions,
shown current, reverted, every change reaching Saved. §27 — the Timesheets panel gathered
a real week (AXM-026 8h + TEST-001 6h, totals both ways), Submit offered, the approver
queue present with its honest "nothing submitted"; Escape closed it and returned focus —
the §31 contract seen working. §28 — every chip kind live: `shipped default` across the
organisation view, a term set at OAPIL Engagement chipping `set here`, the Data Migration
process area beneath chipping `from OAPIL Engagement`, the local row reading "reaches 14
scopes", and the Terminology editor previewing "Would reach 14 scopes." while typing —
then the test term cleared. §29 — `@Dharmendra Kumar Dwivedi` (three words, longest-match)
highlighted in a live note while `@Nobody` stayed plain; a first attempt with a
scenario-fixture name was correctly left as plain text, the parser refusing to guess —
the design working, not a miss. §30 — OAPIL-146 retyped Risk, judged L4×I5 → "= 20 ·
Critical", cleared back to "not yet judged — exposure is computed, never stored", type
reverted; the exposure line appeared and disappeared with the type, riding the stable id.
All test data cleaned up; the pill reached Saved after every step.

## 32 · Guest access — one client's marked content, and nothing else

Two halves; the first needs an Entra admin, the second a separate browser profile.

1. **The invite (operator).** Entra admin center → Users → Invite external user:
   `nishant.ax@gmail.com`. Accept the invitation from that mailbox once.
2. **The seat.** Configuration → Roles & people → add the person with that exact email, a
   client role, and the Client column set to OAPIL. (Until the Client column is set, the
   seat honestly "sees nothing" — the select says so.)
3. **The sign-in.** From a separate browser profile, sign in as the guest. The workspace
   shows ONLY OAPIL's marked records (OAPIL-146 and its marked note today) with their
   ancestor chain — no SLG, no internal records, no rates/time/commercial anywhere in the
   payload (view-source the boot state to check the claim, not the screen).
4. **The two deny cases, read from the banner.** Before step 2's directory entry exists,
   the guest's workspace is empty and the banner says "matches no directory entry"; with
   the entry but no Client set, empty again and the banner says "not attached to a client
   yet". Neither case ever widens to every client's content — that hole is closed
   (GA1, deny-by-default).
5. **The token check.** If the guest's sign-in works but the join fails with the email
   recorded correctly, the id token likely carries only the `#EXT#` UPN — that is the one
   case where the callback grows a normalization, built against this real token.

## 33 · Mobile — installed from the browser, honest offline

1. **Installable.** `/manifest.webmanifest` serves with the four icons resolving; Chrome
   offers Install (desktop: the address-bar icon; Android: Add to Home screen; iOS Safari:
   Share → Add to Home Screen). The installed app launches standalone in the carmine
   chrome.
2. **The one hard rule.** DevTools → Network with the SW active: every `/api/*` request
   reads "(from network)" always — never the worker, never a cache. A `/_next/static`
   asset reads "(from ServiceWorker)" on second load.
3. **Honest offline.** Airplane mode → reload: the offline page, which says out loud why
   nothing is cached and that queued writes are held. Nothing renders from yesterday.
4. **The phone pass** (a real phone, or 390×844 emulation): the app lands usefully — the
   timeline absent, the tree full-width, the detail panel the primary surface; record an
   hour through the grace gate, read the Inbox, open Timesheets as a sheet.
5. **A deploy updates cleanly.** After the next release, a reload picks up the new build;
   the SW version bump clears the old cache on activate.

**Driven 23 Aug 2026 (steps 1–4's drivable halves).** All four assets probe 200 — after the
drive caught its packaging fault: standalone output carries no `public/`, so the first
deploy served a 404 worker and icons; `--extra public=public` joined the release command
and the runbook says why. Live: the worker active at root scope, the version cache holding
EXACTLY the offline page — `/api/*` absent from it after real requests, which is the hard
rule observed rather than assumed. The phone tier proven at a genuine 390px viewport (a
same-origin iframe, after the OS refused the window resize): the tier active, the timeline
gone, the tree at full width. Still waiting on a real phone in a hand: the install itself,
the standalone launch, and Lighthouse — yours to run when convenient.

## What has actually been opened in a browser

Recorded because the distinction turned out to matter more than anything else in this document.
On 18 August 2026 three faults were found by opening screens, and **none of them was visible to
`tsc`, to the build, or to 73 passing scenarios**:

| Fault | Why nothing else could see it |
|---|---|
| The detail form refused a closure naming a reason field it had no box for | The rule was proven; no scenario drives a React component |
| My work and Portfolio summaries cut off mid-word | The text was in the DOM; nothing failed |
| Capabilities and Goals descriptions cut off mid-word | Same cause, a second single-line class |

Sections **1, 11, 12, 13, 14a, 15, 16, 17, 18, 19 (extract half) and 20 (steps 1–7)** have been
driven end to end against production. Section 20 on 22 Aug 2026: Client mail observed
UNREACHABLE with `lostInMerge` naming `mail.send`, granted to Platform Administrator on the
Permissions screen, the no-recipient refusal observed on an internal record, and one real
message sent from OAPIL-147 — From `OAPILCatalyst@`, To the operator's claimed address,
subject `RE: Mail round-trip test [OAPIL-147]` — with the pinned Client Communication note
appearing in Notes without a reload, attributed to the person. The access policy was proven
both ways before the send (`Test-ApplicationAccessPolicy`: Granted for `OAPILCatalyst@`,
**Denied** for another mailbox), after the tenant refused to scope the policy to the shared
mailbox directly and a mail-enabled security group `axiomate-mail-scope@` containing only the
intake mailbox was created to carry it. Step 8 (the emailed reply threading back through
intake) was not driven — the test record was archived first at the operator's direction. Section 18 on 19 Aug 2026: the OAPIL request form was created on screen, rendered
anonymously with zero workspace strings in the HTML, refused a wrong token and a switched-off
form with the identical sentence and status, and a genuine submission filed OAPIL-146 under
OAPIL Engagement — severity High from the stated urgency, the claimed sender on raisedBy, and
the pinned note naming the form. The form was left switched OFF afterwards, pending a decision
on distributing its URL.
Section 17 on 19 Aug 2026: rule RECUR_83 configured on screen, the pass run by hand raised
OAPIL-144 ("Weekly delivery status — 2026-08-19") under OAPIL Engagement, a second run raised
nothing, and the card reads "Last raised for 2026-08-19" with nowhere to edit it. The rule was
then switched off pending a decision on whether the firm wants it live. Two notes: the History
panel does not render the acting name per row, so step 3's attribution is proven by scenario
RW3 rather than by eye; and the run response's `recurrences` field was found missing from the
route's hand-built response — fixed the same day.
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

**Section 19, extract half, 19 Aug 2026:** OAPIL proposed 111 entries (1 dated, offsets
from 2026-08-17), the tier list reading as the reusable D365 shape — Finance, Inventory,
Procurement, Data Migration, Security/Access, Reporting, Quality, Environment/LCS, Production,
Sales, Programme/Contractual, Dispatch. Unticking Finance dropped the count to 93 (itself plus
16 issues); unticking Dispatch dropped only itself, correctly — it holds nothing. The
store-time subtree-prune fix (150c95f) came from this very step: the first run counted an
unticked tier's children, which would have stored orphans that never apply. **Nothing was
stored**: which of the 111 are the firm's repeatable shape is delivery knowledge, and that
judgment is the operator's, not the verifier's.

## Reporting back

For anything that fails, the useful three lines are: **which step**, **what you saw**, and
**the exact message**. The error strings above are quoted from the source, so a difference in
wording is itself a signal.
