---
title: "The core is layered into formula, values, tables, planners and cards"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C130]]"
---
## Decision

Split `crates/solenoid-core/src/` into `formula/`, `values/`, `tables/`, `planners/` and `cards/`, move `V` out of `excel_functions.rs`, and drop the two upward imports (`fns_packs.rs` → `nodes::packs`, `frame_backend.rs` → `nodes::serialize_lambda`).

## Why

The flat module list hides which code depends on which; a layered core is also what a published formula crate would need.

## What ratifying means

- **Ratify:** a mechanical move; every module keeps its contents.
- **Reject:** the core stays flat.
- **Lean:** ratify.
