---
type: area
title: "Client reporting"
created: "2026-08-30"
review_cadence: weekly
tags:
  - area
related_projects: ["report-delivery"]
---

# Client reporting

## Scope

Everything that crosses the client-visible boundary as a document: the weekly client pack, the
monthly governance pack, and the daily IMS. IN scope: content, branding, progress figures,
delivery cadence. OUT of scope: what the boundary itself admits (that is `clientView`'s law,
pinned by scenario RP2's sentinel scan).

## Standards

- Nothing reaches a client unforwarded: packs arrive in the operator's inbox for an eyeball
  first — person-in-the-loop is a recorded decision, not an accident.
- Every pack carries its disclosure line (shown vs total) and progress from record dates.

## Active projects in this area

- [[report-delivery]]

## Reference material

- Builders: `lib/reports/clientPack.ts` (on `clientView()`), `lib/reports/dailyIms.ts`,
  PDFs at `lib/reports/pdf.ts` (report objects only, never state).

## Review cadence

Weekly — Monday's pack email is the natural checkpoint.
