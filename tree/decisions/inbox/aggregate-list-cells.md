---
title: "Aggregate formulas read a list's logicals as 1 and 0 and skip its text"
proposed_ring: D
ask: human
date: 2026-09-25
parents:
  - "[[C10]]"
  - "[[D51]]"
  - "[[A5]]"
---
## Decision

Inside a list, every aggregate formula (SUM, AVERAGE, MIN, MAX, COUNT, MEDIAN, STDEV and the rest) reads TRUE and FALSE as 1 and 0, as the cards do through the logical-number bridge, and skips text, as Excel does, even text that reads as a number.

## Why

The formulas disagree with each other and with the cards today:

| A list holding | Aggregate card | AVERAGE, MEDIAN, STDEV… | SUM | MIN, MAX, COUNT | Excel |
|---|---|---|---|---|---|
| TRUE, 5 | TRUE is 1 (average 3) | TRUE is 1 (average 3) | TRUE skipped (5) | TRUE skipped (COUNT 1) | TRUE skipped |
| "3", 5 | #TYPE! (text can't enter a number list) | "3" is 3 (average 4) | "3" is 3 (8), and "3abc" is 3 too | "3" skipped | "3" skipped |

So `SUM(x > 5)` is 0 while `AVERAGE(x > 5)` is the share of TRUE, and SUM over a list is not AVERAGE times COUNT. SUM, MINA and MAXA also still throw past about 125k values, because Formula.js spreads the list into one call; owning them waits on this rule, since an owned SUM has to pick one reading. **Owner's call:** which reading should every aggregate formula share?

## What ratifying means

- **Ratify (the cards' reading for logicals, Excel's for text):** SUM, MIN, MAX and COUNT start counting logicals, so `SUM(x > 5)` counts the matches; AVERAGE and the statistics stop reading numeric text. SUM becomes owned on the Aggregate card's kernel and takes any length.
- **Reject for Excel's reading:** logicals and text inside a list are both skipped everywhere; `SUM(x > 5)` stays 0 and needs `--(x > 5)` or COUNTIF, as in Excel, and AVERAGE of a logical list goes blank where the card answers.
- **Reject to keep today's split:** SUM stays on Formula.js with its crash past 125k values.
- **Lean:** ratify. Logicals are numbers everywhere else in the graph, and a number stored as text is usually a data problem better left out than silently summed.
