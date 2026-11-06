---
title: "A formula can take the midpoint of two dates, as it can of two temperatures"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-11-06
parents:
  - "[[D115]]"
---
## Decision

A formula over dates would judge the whole expression instead of each operator. Today `(d1 + d2) / 2` is an error at
the `+`, while `AVERAGE(d1, d2)` and `d1 + (d2 - d1) / 2` give the date halfway between. After, all three give that
date. `d1 + d2` alone, `d1 * 2` and a sum of dates stay errors.

## Why

The date rule says dates behave like temperature readings, and readings already work this way: `(a + b) / 2` over
two °C readings is a reading. The two disagree only here.

## What ratifying means

- **Lean:** Ratify: one rule for both, and the midpoint written the obvious way works.
- **Ratify:** `(d1 + d2) / 2` and other weighted averages of dates answer a date in formulas and computed columns.
- **Reject:** dates keep checking each operator, and the date rule's line saying dates and readings agree is
  corrected instead.
