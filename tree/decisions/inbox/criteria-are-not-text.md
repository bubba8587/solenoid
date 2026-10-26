---
title: "COUNTIFS and its kin take a condition as an operator and a value instead of a text string like '>5'"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C131]]"
---
## Decision

COUNTIFS, SUMIFS and the rest of that family take each condition as an operator plus a typed value, as the List Filter card already does, and Excel's condition strings go away. Today you write `COUNTIFS(dates, ">1-Jan-2026")`. After, the operator and the date are given separately; the exact way to write that in a formula is still to be designed.

## Why

You asked for the strings to go. They are also the last place a formula reads a date out of text, which the rule against guessing types from text forbids.

## What ratifying means

- **Lean:** Ratify, and design the new form first. Two separate arguments is the obvious shape, but how to write one inline needs your call.
- **Ratify:** A design pass, then the strings are replaced outright and old formulas using them break (pre-alpha).
- **Reject:** The strings stay, as in Excel.
