---
type: resource
title: "Alerting"
created: "2026-08-30"
tags:
  - resource
---

# Alerting

Who gets told when unattended automation breaks. This config lives in Azure, not the repo —
which is exactly how it silently rotted once: the pass-failure alert existed and was enabled
from the start, but its action group had **zero receivers**. It fired into a void. Fixed
2026-08-30; this page is the record that keeps it checkable.

## The wiring

| Piece | Resource | Detail |
|---|---|---|
| Action group | `axiomate-scheduled-pass-operators` | email → sekharn@axiocloudsolutions.com (added 2026-08-30; was EMPTY) |
| Pass failure alert | `axiomate-scheduled-pass-failed` | RunsFailed ≥ 1 on the daily-pass Logic App, 1h window, 15m eval |
| Intake failure alert | `axiomate-intake-failed` | RunsFailed ≥ 3 in 1h on the 3-minute intake watcher — sustained breakage alerts, single blips retry silently |
| Refusal escalation | in the pass workflow itself | a new `Fail_when_the_pass_reports_refusals` condition: an HTTP 200 whose body says `ok:false` OR carries non-empty `delivery.refused` TERMINATES the run as Failed → RunsFailed → the same alert. A refused report email is operator-attention, not success. |

Verified 2026-08-30: manual trigger of the updated workflow ran Succeeded in 4s (token
survived the SecureString round-trip, no false positive on a healthy pass); run history shows
daily successes since 08-17, so nothing was missed while the group was empty.

## Deliberately NOT alerted

- `notifications.failed` from the drain — chronically non-zero while 13 directory people lack
  emails; alerting on it would train everyone to ignore the channel. Revisit when the
  directory is filled in.
- Single intake failures — the 3-minute cadence retries them naturally.

## To check it still works

```
az monitor action-group show -g Axiomate-TMS-RG -n axiomate-scheduled-pass-operators --query emailReceivers
az monitor metrics alert list -g Axiomate-TMS-RG --query "[].{name:name, enabled:enabled}" -o table
```

An empty receivers list is the failure mode this page exists to prevent recurring.

## Related

- [[release-readiness]] (R1)
