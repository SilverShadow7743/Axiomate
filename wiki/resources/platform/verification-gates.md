---
type: resource
title: "Verification gates"
created: "2026-08-30"
tags:
  - resource
---

# Verification gates

The standing discipline every change passes before it ships. Reference, not narrative — the
commands and their expected shapes.

## The gate, in order

```
npx tsc --noEmit                 # clean
npm run validate:scenarios       # 188 scenarios, 0 FAIL (data/validation.json rides the commit)
npm run build                    # before any deploy
```

## The four audits (untouched unless their domain moves)

```
npm run audit:tenancy            # 33 row mappers, all stamp tenantId
npm run audit:persistence        # 71 — reducer out == Postgres back
npm run audit:attribution        # 3/3 arms follow the actor parameter
npm run audit:discussion         # 11 checks
```

## Standing traps

- A new reducer arm persists NOTHING without its `persistSteps` case — same commit, always.
- Stored role grants beat seeds per-role: a newly seeded permission never reaches an existing
  workspace's stored grants; fix live via Configuration → Permissions.
- Scenario splices: temp file + python replace at a unique marker (heredocs eat escapes).
- Deploys: staged FOREGROUND only (fresh dir → git archive → npm ci → build → package-release →
  migrate status → az webapp deploy).
