---
title: "A Schedule row may repeat at most 1,000 times; past that the row shows #OVERFLOW!"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C70]]"
  - "[[C17]]"
---
## Decision

A Repeat count above 1,000 makes that row #OVERFLOW!, naming the cap, and creates no occurrences; the rest of the schedule still computes. Today a Repeat of 1e9 tries to build a billion tasks and the app hangs with no error.

## Why

Other generators are capped at one million, but even a million tasks would stall the critical-path math and the Gantt, so the Schedule needs a lower cap. The number is yours.

## What ratifying means

- **Lean:** Ratify 1,000 (about 19 years of a weekly task, or nearly 3 of a daily one). A plan needing more is better modeled as a recurring rule than as rows. This goes with the note on bad rows: if a bad Duration keeps failing the whole Schedule, an oversized Repeat should too, so decide the two together.
- **Ratify:** An oversized Repeat shows #OVERFLOW! on its row, and the schedule stays fast.
- **Reject:** A higher cap: 10,000 (a daily task for 27 years, but a few such rows make the Gantt slow to draw), or one million like other generators (the error can take minutes to appear).
