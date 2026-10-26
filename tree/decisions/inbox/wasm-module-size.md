---
title: "The one wasm module stays whole"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C130]]"
---
## Decision

Keep the core as one 4.6 MB wasm module (1.26 MB brotli) rather than splitting it.

## Why

No module dominates (largest about 7%), so a split saves little; the first render already waits only on graph surfaces (`coreReady.ts`).

## What ratifying means

- **Ratify:** no split; size work goes into what the first load waits on.
- **Reject:** split the module by family and load on demand.
- **Lean:** ratify.
