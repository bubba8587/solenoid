---
title: "A Pivot keeps a field whose column briefly disappears from its source, and flags it"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C127]]"
---
## Decision

When a column a Pivot uses goes missing from its source table, the Pivot keeps the field in its layout, marked missing in Configure Fields, instead of dropping it. Today, if a Region column vanishes for a moment while you edit upstream, the Pivot forgets where Region was and you set the layout up again. After, Region returns to its place when the column comes back.

## Why

Dropping the field was meant for swapping in a different source, but it also throws away your layout when a column is only briefly gone.

## What ratifying means

- **Lean:** Ratify. The app keeps what you set.
- **Ratify:** The field stays, marked missing.
- **Reject:** The field is dropped, as today.
