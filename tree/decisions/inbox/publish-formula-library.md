---
title: "The formula library is published as its own crate"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C17]]"
---
## Decision

Export the core's function bodies (`excel_functions.rs`, `fns_*.rs`) as a crate of their own, with the frozen fixtures as its tests.

## Why

Formula.js is gone; the core owns every body. A public crate would have to keep its API stable, which pre-alpha (B7) does not ask of the core today.

## What ratifying means

- **Ratify:** the bodies get a public API and a crate; changes to them start to count as breaking.
- **Reject:** the bodies stay internal to `solenoid-core`.
- **Lean:** defer until the core's layering settles (see core-layers), then publish.
