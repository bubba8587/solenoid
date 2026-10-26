---
title: "The calculation engine keeps downloading as one file instead of being split"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C130]]"
---
## Decision

Keep the engine as one 4.6 MB file (1.26 MB compressed) that the app loads, rather than splitting it into pieces loaded when first needed. Nothing changes on screen.

## Why

No single part dominates (the largest is about 7%), so splitting saves little, and the first screen already waits only on what drawing the graph needs.

## What ratifying means

- **Lean:** Ratify.
- **Ratify:** No split; size work goes into what the first load waits on.
- **Reject:** The engine is split by function family, each piece loaded when first used.
