---
title: "A COUNTIFS-style criterion is an operator and a typed value, not a text string"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C131]]"
---
## Decision

COUNTIFS, SUMIFS and kin take a criterion as an operator plus a typed value (as the List Filter card does), and the `">5"` strings go.

## Why

The author wants Excel's criterion strings gone (2026-10-23). They are the last place a formula reads a date out of text, against C131.

## What ratifying means

- **Ratify:** a design pass for the new criterion form, then the strings are replaced (pre-alpha, no shim, B7).
- **Reject:** the strings stay, as Excel has them (B19 spreadsheetHabits).
- **Lean:** ratify, and design the form first: the operator and value as two arguments is the obvious shape, but how a formula writes one inline needs a call.
