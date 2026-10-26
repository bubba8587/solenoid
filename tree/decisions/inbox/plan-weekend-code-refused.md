---
title: "Schedule, Gantt and Earned Value give an error for a weekend code that WORKDAY.INTL doesn't know"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C70]]"
---
## Decision

The plan cards refuse a weekend code that isn't one of WORKDAY.INTL's codes, as WORKDAY.INTL and the Workdays card already do. Today a mistyped code such as 99 on a Schedule silently means Saturday and Sunday. After, it shows #NUM! naming the code.

## Why

The plan cards and the formula read the same code differently.

## What ratifying means

- **Lean:** Ratify. One code should mean one thing everywhere.
- **Ratify:** A mistyped code on a plan card is an error that names it.
- **Reject:** The plan cards keep falling back to Saturday and Sunday.
