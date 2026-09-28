---
title: "INDEX's whole column comes out as a one-column table, as Excel's does"
proposed_ring: D
ask: human
date: 2026-09-28
parents:
  - "[[D85]]"
  - "[[A5]]"
---
## Decision

`INDEX(m, 0, c)`, a whole column of a table, answers a one-column table in the formula and on the INDEX card, as Excel's column does, instead of a list.

## Why

[[D85]] columnsStayColumns keeps a column-shaped answer a column because a column read as a list turns into a row, and formulas built on it come out wrong without an error. Whole-column INDEX is that case and isn't on D85's list: over `m = [[3,1,2],[9,8,7]]`, `m / INDEX(m, 0, 1)` divides across the columns instead of each row by its first value, `HSTACK(m, INDEX(m, 0, 1))` spills sideways, and `SORTBY(m, INDEX(m, 0, 2))` sorts the columns. The formula-language spec says a whole column comes out as a list, and the help points at INDEX as a way to pull a list out of a table, so the list is a deliberate card convenience; the formula and the card share `indexInto` ([[C17]] shareImpl), so one answer serves both.

## What ratifying means

- **Ratify:** `indexInto` answers a one-column table for a whole column; the formula matches Excel, and the INDEX card's output is a one-column table too. Pulling a list out of a table is Get Column, or TOROW after INDEX.
- **Reject:** a whole column stays a list on both surfaces; the three formulas above keep their wrong answers, which then need a note in formula-language's divergences.
- **Variant:** the formula answers a column and the card keeps its list, splitting the kernel's answer by surface against C17.
- **Lean:** ratify. The formula's answer is silently wrong today, and the card has Get Column for the list.
