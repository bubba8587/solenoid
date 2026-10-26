---
title: "Formula columns stay on a Cube Input's top table only"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[D90]]"
---
## Decision

On Cube Input (the card for typing tables that hold tables in their cells), formula columns stay on the top-level table; nested tables don't get them. Nothing changes: today you can add a formula column to the top table but not to a table inside a cell, and that stays.

## Why

Column types already reach every level. Formula columns on nested levels were left for "if wanted".

## What ratifying means

- **Lean:** Ratify until a plan needs one.
- **Ratify:** No change.
- **Reject:** Nested tables get formula columns too.
