---
title: "How PIVOTBY reads list and grid cells"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B17]]"
---
## Decision

Pick how a PIVOTBY group reads Cube list cells (pool items vs average of row results) and grid cells (pool every cell, lists only, or each grid column as a field); the work is parked on branch `pivot-list-cells`.

## Why

The author is choosing; D96 pivotPoolsItems lives on that branch.

## What ratifying means

- **Ratify:** the branch merges with the picked reading.
- **Reject:** PIVOTBY keeps refusing list cells.
- **Lean:** pool items for lists; each grid column as a field.
