# Intake forms — design

Approved 19 August 2026. Phase 3 of the Hive gap program.

## What is being built

A public form page a client can be given — `/intake/form/{token}` — that captures structured
work and feeds the same intake pipeline the mailbox feeds: same classification, same routing,
same `create` through the reducer with the machine actor, same provenance note ("arrived via
the OAPIL request form" rather than "by mail"). Structure at the point of capture, instead of
prose re-typed by whoever reads the mailbox.

## The trust model, stated plainly

It is the mailbox's own model. `OAPILCatalyst@` accepts content from anyone who knows the
address; a form accepts content from anyone who knows the URL. The firm's no-login rule bends
for CAPTURE, never for DISCLOSURE: the form page renders nothing from the workspace — no
names, no counts, no work-type vocabulary. Its fields are fixed and generic: your name, your
email, subject, what happened, and urgency in plain words. Classification into the firm's own
types stays server-side, where it already lives.

The sender's name and email are recorded as claims, exactly as an email `From:` already is —
unverified, and presented as such downstream.

## Configuration

`IntakeForm` lives beside `IntakeMailbox` in the `OperatingModel`:

    { id, name, scopeId, enabled, token }

The token is minted when the form is created and shown as a full URL on the Configuration
screen (in Routing & intake, where mailboxes already live). The same `canParent('issue', …)`
guard applies at write time. Disabling the form kills the URL instantly. Two new `ConfigOp`
kinds (`upsertIntakeForm`, `deleteIntakeForm`) registered in the compile-time-exhaustive
`CONFIG_OPS`. No migration; one explicit `mergeModel` line, as always.

## Submission

The page POSTs to a sibling endpoint that:

1. resolves the token against configuration — an unknown token and a disabled one produce the
   same refusal, with nothing revealed;
2. validates the fields (name, email shape, subject, description present; urgency one of the
   three words);
3. synthesizes the `InboundMessage` shape with a server-minted message id and hands it to the
   existing pipeline, so duplicates, routing and filing behave exactly as mail does.

Urgency maps to severity directly (urgent → High, normal → Medium, low → Low) and is a claim
like everything else on the form. Status is the entry state; a machine may file work, it may
not decide it is being worked on.

## After submit

The page shows the issue's display id — "Received — reference OAPIL-145". A ticket number is
how the client refers to the work later, and it is the one workspace fact the page discloses.

## Deliberately absent, named

CAPTCHA and rate limiting (the token is the gate, as the mailbox address is); file attachments
(documents ride phase 6's proofing work); any listing of previously submitted items (that is
guest access — phase 7's problem, which gets its real answer there rather than a half-answer
here).

## Testing

Pure logic first: token resolution and field validation proven by scenarios before the
endpoint exists — unknown/disabled tokens refuse identically, a valid submission produces the
right InboundMessage shape. Then the endpoint, then the page (the browser part, last),
checklist section 18, and one real submission driven through production.
