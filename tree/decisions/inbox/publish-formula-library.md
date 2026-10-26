---
title: "Solenoid's Excel function library is published for others to use"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C17]]"
---
## Decision

Release the engine's function code (SUM, XLOOKUP and the rest) as its own open-source Rust package, with today's recorded answers as its tests. Nothing in the app changes. Today the functions live only inside Solenoid; after, other programs could use them.

## Why

Solenoid now owns every function. A public package must keep its interface stable, which the engine doesn't need while pre-alpha.

## What ratifying means

- **Lean:** Wait until the engine's code is sorted into layers (the note on five layers), then publish.
- **Ratify:** The functions get a public interface, and changing them starts to count as breaking other people's code.
- **Reject:** The functions stay internal.
