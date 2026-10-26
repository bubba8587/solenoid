---
title: "PIVOTBY pools the items of list cells, and reads each column of a grid cell as its own field"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B17]]"
---
## Decision

When a Cube (a table whose cells can hold lists or grids) feeds PIVOTBY, a list cell's items are pooled into its group: rows holding 1, 2 and 3, 4, 5 average to 3 (pooled), not 2.75 (the average of each row's average). A cell holding a grid is read with each of its columns as a field. Today PIVOTBY refuses list cells. The work is ready on a separate branch.

## Why

You were choosing between readings that give different answers.

## What ratifying means

- **Lean:** Ratify.
- **Ratify:** The waiting work merges with these readings, and PIVOTBY accepts list and grid cells.
- **Reject:** PIVOTBY keeps refusing list cells. To choose differently instead: average each row's result for lists, and pool every grid cell or read lists only for grids.
