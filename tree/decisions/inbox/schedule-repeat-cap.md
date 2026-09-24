---
title: "A Schedule row's Repeat count has a cap; past it the row is #OVERFLOW!"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C70]]"
  - "[[C21]]"
---
## Decision

A Repeat count above a fixed cap makes that row `#OVERFLOW!`, a per-row fault like a bad duration, and generates no occurrences. The cap is the owner's pick.

## Why

`scheduleCpm.ts` builds one occurrence task per Repeat, with no limit. A Repeat of 1e9 tries to build a billion tasks and the app hangs; there is no error to catch because the pass never returns. Every other generator is capped ([[C21]] matchNodeLimits caps lists at `MAX_GENERATED`, one million), but a million tasks would still stall the critical-path pass and the Gantt, so the list cap is too high here. **Owner's call:** how many occurrences one row may generate.

## What ratifying means

- **1,000 per row:** about 19 years of a weekly task or nearly 3 years of a daily one. Past that, the row shows `#OVERFLOW!` naming the cap. The rest of the schedule still computes.
- **10,000 per row:** covers a daily task for 27 years, but a few such rows make the Gantt slow to draw.
- **`MAX_GENERATED` (one million):** one cap for every generator, but the pass can still take minutes before the error appears.
- **Lean:** 1,000 per row. A plan with more occurrences than that is better modeled as a recurring rule than as rows, and the cap keeps the pass fast.
