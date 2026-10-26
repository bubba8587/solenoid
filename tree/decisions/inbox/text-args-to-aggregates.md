---
title: "SUM('a') gives #VALUE!, as in Excel, instead of 0"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[B17]]"
  - "[[A5]]"
---
## Decision

Text passed straight to an aggregate, not inside a range, is #VALUE!. Today `SUM("a")` is 0 and `AND("a", TRUE)` is TRUE; after, both are #VALUE!. Text inside a list or range is still skipped. A text value wired into an aggregate card's single-value input counts as passed straight.

## Why

Text is silently skipped today. On the canvas a wired single value could be read either way, so the rule has to say which.

## What ratifying means

- **Lean:** Ratify. A 0 that hides a typo is worse than an error that points at it.
- **Ratify:** `SUM("a")` and `AND("a", TRUE)` give #VALUE!, on formulas and cards alike.
- **Reject:** Text is skipped everywhere, so `SUM("a")` stays 0.
