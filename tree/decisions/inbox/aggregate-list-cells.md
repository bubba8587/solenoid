---
title: "Every aggregate counts TRUE as 1 and FALSE as 0 inside a list, so SUM(x > 5) counts the matches"
proposed_ring: D
ask: human
date: 2026-10-29
parents:
  - "[[C10]]"
  - "[[C24]]"
  - "[[A5]]"
---
## Decision

Checked against the code on 2026-10-29. With `x = 1, 6, 7`, the aggregates disagree today: `SUM(x > 5)`, `MIN`, `MAX` and `COUNT` give 0, skipping TRUE and FALSE, while `AVERAGE(x > 5)` gives 0.67, `MEDIAN` 1 and `STDEV` 0.58, counting them as 1 and 0. The choice is which way they all go. Counting: `SUM(x > 5)` is 2, the number of matches. Skipping, as Excel does inside a list: `SUM(x > 5)` stays 0, and `AVERAGE(x > 5)` becomes blank.

## Why

Half the aggregates count and half skip, so the same list gives answers that don't fit together.

## What ratifying means

- **Lean:** Ratify. TRUE and FALSE already act as 1 and 0 elsewhere in the graph, and counting matches with SUM is the common need.
- **Ratify:** Every aggregate counts them; `SUM(x > 5)` counts matches.
- **Reject:** Every aggregate skips them, as Excel does; counting matches needs COUNTIF.
