# Forms — structured capture, without a field that fakes progress

*7 September 2026. From the Hive gap survey's "Forms" line. Checked first: nothing generic exists.
`app/intake/form/[token]` is one fixed public page for external capture, not a builder.
`DocumentReview` (`lib/proofing.ts`) asks one free-text question and takes one approved/changes
verdict per reviewer — real, but a single question, not a form. Neither generalises.*

## The conflict, precisely

`lib/goals.ts`'s own rule, stated for a different feature but binding here too:

> *"Nobody types the progress... A goal at 80% that has been 80% for a month is the normal state
> of such a screen... a measure may only exist if its source can be named."*

A generic form builder that lets somebody add a "% complete" or "progress" question type
reintroduces exactly the thing `lib/goals.ts` refused — a number a person types, that drifts from
reality in one direction, with no record behind it. The same objection `discipline`
(`IssueRecord.discipline`) already settled for classification applies to progress: a field the
UI cannot tell from a person's honest judgement is not safe to build.

## The resolution: capture facts, never capture a derived measure

A form's questions are typed, and the type vocabulary is closed **on purpose**, mirroring
`lib/checklist.ts`'s own item shape (a fact, not a summary):

```
QuestionType = 'text' | 'yesNo' | 'choice' | 'number' | 'date'
```

Every one of these is a fact somebody states about the world — "the client's PO number is
4471-B", "yes, the environment was refreshed", "how many defects found in this pass: 12". None of
them can encode "how much of this is done," because a form is never the record of an ongoing
thing's completion — it is the record of a point-in-time capture, closer to a note with structure
than to a status. **Refused explicitly, not by omission:** a template question whose label matches
`/progress|%\s*complete|completion/i` is rejected at save time with a message naming
`lib/goals.ts`'s own reasoning, so the refusal teaches the person asking rather than just blocking
them.

## Schema

```prisma
model FormTemplate {
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  /// `frm-12`, minted from the durable workspace counter.
  id   String
  name String
  /// Ordered list of {id, label, type, choices?, required}. Not its own table: a template's
  /// questions change together, as a set, the same reasoning ProjectTemplate's own shape
  /// (lib/config.ts) already applies to its checklist.
  questions Json

  createdBy String
  createdAt DateTime
  deletedAt DateTime?

  responses FormResponse[]

  @@id([tenantId, id])
}

model FormResponse {
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  id         String
  templateId String
  template   FormTemplate @relation(fields: [tenantId, templateId], references: [tenantId, id], onDelete: Restrict)
  /// What this response is about — an issue, most often. No FK, like ChangeRequest.issueId:
  /// the subject being archived must not silently delete a capture that already happened.
  subjectId  String

  /// {questionId: answer}, shaped by the template's own question list at submit time.
  answers Json

  submittedBy String
  submittedAt DateTime
  deletedAt   DateTime?

  @@id([tenantId, id])
  @@index([tenantId, templateId])
  @@index([tenantId, subjectId])
}
```

`Json` for `questions`/`answers`, not a normalised per-question table — the same call
`Issue.assignments` already makes for "values for configured types that have no column of their
own." A form's shape is defined once per template and read together; splitting it into rows would
buy nothing this codebase's own precedent doesn't already argue against.

## Where it surfaces

Configuration → a new "Form templates" section (`config.manage`, same as `ProjectTemplate`),
building the question list. A "Capture" action on an issue lists templates and opens one as a
plain form; submitted responses show read-only on the issue, ordered newest first — the same
shape `NotesTab` already gives a working record, minus editing (a submitted capture is a point-in-
time fact; correcting it is a new response, the same "withdraw and re-raise" pattern
`upsertMilestone` uses for an accepted milestone).

## What this does not do

No conditional logic (question N shown only if question 2 was "yes") — every question in a
template is asked every time; branching is a v2 problem this gap survey did not ask for. No
scoring or pass/fail computed from answers — that is exactly the "a number nobody can argue with
because the weights are hidden" objection `lib/portfolio.ts` already raised about a blended
score, applied to forms instead of engagements. No public-facing form builder for clients — the
intake page stays the one external capture surface; a form template is internal, gated the same
as everything else `config.manage` reaches.

## What would send this back

If a real use case needs a question whose answer legitimately IS a completion percentage — a
client's own maturity self-assessment, say, where the number is *their* stated claim, not this
firm's derived fact — the refusal rule above would need to distinguish "a fact somebody is
reporting" from "a measure this application is computing," which the label-matching heuristic
above cannot reliably do. That is a real edge worth naming, not a flaw to quietly patch around.
