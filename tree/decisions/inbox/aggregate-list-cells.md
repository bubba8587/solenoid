---
title: "SUM, MIN, MAX and COUNT count TRUE as 1 and FALSE as 0 inside a formula's list, as AVERAGE already does"
proposed_ring: D
ask: human
date: 2026-09-25
parents:
  - "[[C10]]"
  - "[[D51]]"
  - "[[A5]]"
---
## Decision

Every aggregate formula (SUM, AVERAGE, MIN, MAX, COUNT, MEDIAN, STDEV and the rest) reads TRUE and FALSE inside a list as 1 and 0, as the cards already do. With `x = 1, 6, 7`, today `SUM(x > 5)` is 0. After, it is 2, the number of matches.

## Why

The formulas disagree today: AVERAGE and the other statistics count TRUE as 1, but SUM, MIN, MAX and COUNT skip it, so `AVERAGE(x > 5)` is 0.67 while `SUM(x > 5)` is 0. Excel skips them all, hence its `SUM(--(x > 5))`.

## What ratifying means

- **Lean:** Ratify. TRUE and FALSE are numbers everywhere else in the graph.
- **Ratify:** `SUM(x > 5)` counts the matches and `MAX(x > 5)` says whether any matched. SUM also stops failing on lists longer than about 125,000 values.
- **Reject:** Every aggregate skips TRUE and FALSE in a list, as Excel does: `SUM(x > 5)` stays 0 and needs COUNTIF, and AVERAGE of such a list goes blank.
