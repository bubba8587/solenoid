---
title: "Every aggregate formula reads a logical as 1 and 0"
proposed_ring: D
ask: human
date: 2026-09-25
parents:
  - "[[C10]]"
  - "[[D51]]"
  - "[[A5]]"
---
## Decision

Every aggregate formula (SUM, AVERAGE, MIN, MAX, COUNT, MEDIAN, STDEV and the rest) reads TRUE and FALSE inside a list as 1 and 0, as the cards do through the logical-number bridge.

## Why

A list of logicals mostly comes from inside a formula, such as `x > 5`, since a card's number socket already turns TRUE into 1. The formulas read it three ways today: AVERAGE, MEDIAN, STDEV and the other statistics count TRUE as 1, SUM skips it, and MIN, MAX and COUNT skip it. So over `x = 1, 6, 7`, `AVERAGE(x > 5)` is 0.67 while `SUM(x > 5)` and `COUNT(x > 5)` are 0, and SUM over a list is not AVERAGE times COUNT. Excel skips logicals held in a range, which is why it needs `SUM(--(x > 5))`. SUM also still throws past about 125k values, because Formula.js spreads the list into one call; owning it waits on this rule, since an owned SUM has to pick one reading. **Owner's call:** count logicals everywhere, or skip them everywhere as Excel does?

## What ratifying means

- **Ratify:** SUM, MIN, MAX and COUNT count logicals, so `SUM(x > 5)` counts the matches and `MAX(x > 5)` says whether any matched. SUM becomes owned on the Aggregate card's kernel and takes any length.
- **Reject for Excel's reading:** every aggregate skips logicals held in a list; `SUM(x > 5)` stays 0 and needs `--(x > 5)` or COUNTIF, and AVERAGE of a logical list goes blank where the card answers.
- **Lean:** ratify. Logicals are numbers everywhere else in the graph.
