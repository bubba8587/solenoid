---
title: A frame column shows its unit where its cells are read
proposed_ring: D
ask: human
date: 2026-10-22
parents:
  - "[[C25]]"
  - "[[D43]]"
---
## Decision

A Frame column with a unit shows it where its numbers are read: in the column's header on the Frame card and the table popup (`dist (km)`), or as the unit affix on each cell (`100 km`, `$45`), as a Format Controller's value already shows.

## Why

Today a column's unit shows only inside its format button, as a disabled unit dropdown, so a km column reads `100`, and a computed column whose unit the formula works out ([[D100]] computedColumnInfersUnit) gives no sign of it. The value box already wraps its number in the unit affix (format-model.md, "Unit affix"), so a frame is the one surface where a unit is real but unseen. **Owner's call:** the header, the cells, or both?

## What ratifying means

- **Header:** one label per column, nothing repeated; cells stay narrow. The popup's header already holds the name, the type icon and the format button.
- **Cells:** each number reads whole (`100 km`), as a value box does, at the cost of width in every row.
- **Reject:** the unit stays in the format button only.
- **Lean:** the header. A column holds one unit, so one label says it.
