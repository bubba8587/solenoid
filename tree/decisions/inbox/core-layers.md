---
title: "The calculation engine's code is sorted into five layers"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C130]]"
---
## Decision

The code that does Solenoid's math is reorganized into five groups: formulas, values, tables, planners and cards, each relying only on the ones below it. Today it is one flat list of files, and a couple of low-level pieces reach up into card code. Nothing in the app changes; the code moves without changing what it does.

## Why

The flat list hides which code depends on which. A layered engine is also what publishing the function library on its own would need.

## What ratifying means

- **Lean:** Ratify.
- **Ratify:** A mechanical move with no visible change.
- **Reject:** The engine's code stays one flat list.
