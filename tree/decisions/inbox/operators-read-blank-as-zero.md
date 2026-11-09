---
title: "A blank in a formula comparison reads as 0 or empty text, as in Excel"
proposed_ring: B
ask: human
made_by: ai
by: Claude
date: 2026-11-04
parents:
  - "[[D124]]"
  - "[[C24]]"
---
## Decision

Today a formula comparison with a blank side answers blank: with `x` blank, `x > 5`, `x = 0` and `ABOVE(x, 5)` are all blank. Excel reads the blank as 0 or empty text, so `x = 0` is TRUE and `x > 5` FALSE. The comparison functions now answer exactly as the operators do, so this one choice sets both; the cards answer blank either way.

## Why

The new comparison rule says the functions match the operators "as Excel's operators do (a blank reads as 0 or empty text)", but Solenoid's operators keep a blank blank, so a missing value never turns into a made-up 0. Both can't hold.

## What ratifying means

- **Lean:** Reject: keep a blank blank in formulas, and drop the Excel parenthetical from the rule.
- **Ratify:** every formula comparison reads a blank as 0 or empty text, so `IF(x > 5, …)` with `x` empty takes the "no" branch instead of answering blank.
- **Reject:** formulas keep answering blank for a blank comparison, as now.
