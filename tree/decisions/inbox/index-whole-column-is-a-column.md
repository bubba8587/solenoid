---
title: "INDEX with row 0 gives a whole column as a one-column table, as in Excel"
proposed_ring: D
ask: human
date: 2026-09-28
parents:
  - "[[D85]]"
  - "[[A5]]"
---
## Decision

`INDEX(m, 0, c)`, a whole column of a table, gives a one-column table in formulas and on the INDEX card, as in Excel, instead of a list. With `m = [[3,1,2],[9,8,7]]`, today `m / INDEX(m, 0, 1)` divides across the columns. After, it divides each row by its first value.

## Why

A list reads as a row, so a column turned into a list silently changes direction, and formulas built on it come out wrong with no error.

## What ratifying means

- **Lean:** Ratify. The formula's answer is silently wrong today, and Get Column still gives a list.
- **Ratify:** Formulas match Excel, and the INDEX card also outputs a one-column table. To get a list, use Get Column, or TOROW after INDEX.
- **Reject:** A whole column stays a list, and the wrong answers are written down as a difference from Excel. A middle way (column in formulas, list on the card) breaks the rule that a card and its formula agree.
