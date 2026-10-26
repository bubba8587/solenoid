---
title: "A weekend code outside WORKDAY.INTL's table is #NUM! on the plan cards"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C70]]"
---
## Decision

Schedule, Gantt and Earned Value refuse a weekend code that is not a WORKDAY.INTL code, as WORKDAY.INTL and Workdays do.

## Why

Today the plan cards read such a code as Saturday and Sunday, silently, while the formula answers #NUM!.

## What ratifying means

- **Ratify:** a typo'd code on a plan card is an error naming it.
- **Reject:** the plan cards keep the fallback.
- **Lean:** ratify: one reading per code.
