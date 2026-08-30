---
type: resource
title: "Restore drill"
created: "2026-08-30"
tags:
  - resource
---

# Restore drill

Backup restore was rehearsed for the first time on 2026-08-30 — recovery is now proven, not
presumed. Repeat roughly quarterly, or after any storage-shape change.

## The result

| Measure | Value |
|---|---|
| Method | Azure point-in-time restore of `axiomate-tms-db` to a scratch server |
| Restore point | 2026-08-30T16:59:31Z (15 minutes in the past) |
| Time to Ready | **~5–6 minutes** (command 17:14:31Z → Ready before 17:20Z) |
| Verification | every public table counted on both servers: **39/39 count-identical** |
| Cleanup | scratch server deleted; production untouched throughout |

## The recipe (all from az, ~15 minutes end to end)

```bash
# 1. Restore to a scratch server (choose a recent UTC restore point)
az postgres flexible-server restore -g Axiomate-TMS-RG -n axiomate-tms-db-drill \
  --source-server axiomate-tms-db --restore-time <UTC ISO>

# 2. Open the scratch server to your client IP (restored servers have NO rules)
az postgres flexible-server firewall-rule create -g Axiomate-TMS-RG -s axiomate-tms-db-drill \
  --name drill-client --start-ip-address <ip> --end-ip-address <ip>

# 3. Verify: connect with the SAME credentials as production (the restore clones them),
#    set app.tenant_id (forced RLS applies to owners too), count every public table on
#    both servers, compare. A per-table count match plus a spot-read is the drill's bar.

# 4. Delete the scratch server
az postgres flexible-server delete -g Axiomate-TMS-RG -n axiomate-tms-db-drill --yes
```

Traps found and encoded: the firewall flags are `--server-name`/`--name` (not `--rule-name`);
restored servers start with zero firewall rules; the connection string is production's with
the host swapped to `-drill`.

## Related

- [[release-readiness]] (R2)
- [[alerting]]
