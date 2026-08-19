# Email send — design

Approved 19 August 2026. Phase 5 of the Hive gap program.

## What is being built

The other half of intake's loop. An issue born from a client's mail or form submission can now
be answered FROM the record: a compose on the issue panel, sending as the engagement's own
mailbox, recorded on the record on success. The reply threads back through intake by the
reference in the subject, so the conversation and the register stop being separate worlds.

## The sending identity is the receiving one

Replies go out as the intake mailbox — `OAPILCatalyst@` for OAPIL — chosen as the enabled
intake mailbox whose scope covers the issue (nearest ancestor's mailbox wins where several
could). Not new configuration: the mailbox that would receive the reply is the one that speaks.
An issue no mailbox covers refuses at the door: "no mailbox is configured to speak for this
part of the tree."

## Permission: a new key, because clients receive this

`mail.send` joins the permission table. Sending a client an email is a distinct authority from
editing work; a firm that lets an analyst triage without writing to clients needs those
separable. It becomes the 20th capability. Stated consequence: `mergeModel` keeps stored
grants, so existing roles hold the new key only after somebody grants it — the Capabilities
screen shows it unreachable with `lostInMerge` naming it, which is what that screen is for.

## Who sends: people only

The compose opens from an issue whose `raisedBy` carries a sender claim ("Name <email>" — the
shape intake and forms both write). Attributed to the person who clicked. Agents and
automation do not send: proposing a reply is agent work; dispatching one to a client is not.

## What is recorded

On success — and only on success — the sent message becomes a pinned Client Communication
note: recipient, subject, body. What was said to a client is part of the record. A failed send
records nothing and says so; there is no "attempted" note, because the record holds what
happened.

## The subject carries the reference

`RE: <subject> [OAPIL-146]` — which is what makes the client's answer classifiable back to the
same engagement by the pipeline that already runs. Intake's duplicate check is untouched; a
reply is a new message with its own id.

## The tenant side

`Mail.Send` application permission on the Axiomate app registration, admin-consented, and —
non-negotiable — an Exchange **Application Access Policy** restricting the app to the shared
mailbox: app-only Mail.Send without the policy is send-as-anyone-in-the-tenant. Both are
operator-granted infrastructure, done with explicit confirmation, and the endpoint's refusal
string names them when they are missing.

## Error handling

No sender claim on the issue: the compose does not open, with the reason shown. No covering
mailbox: refused at the door. Graph refusal (consent revoked, policy missing, mailbox
deleted): the endpoint reports one honest sentence, the full error goes to the server log, and
nothing is written to the record.

## Testing

Pure first: mailbox resolution (nearest covering mailbox; none → refusal), recipient
extraction from the claim, subject composition with the reference. Then the endpoint gated on
`mail.send` and a session. The Graph call itself is only provable live: checklist section 20
sends one real message to the operator's own address and follows it back in through intake to
the same engagement.
