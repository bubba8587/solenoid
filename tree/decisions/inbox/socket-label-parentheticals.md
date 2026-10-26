---
title: "Unit and binding parentheticals move to the Inspector"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B14]]"
---
## Decision

The unit parentheticals (`T (K)`, `(UTC)`, `Marker size (px)` and kin) and the λ-table binding hints (`Values (value)`, `value2 (optional)`) leave socket labels for the Inspector's per-socket descriptions; math notation stays.

## Why

The author asked for the sweep; the binding hints are a named exception in B14, so moving them amends that leaf.

## What ratifying means

- **Ratify:** labels lose the parentheticals; B14's exception goes.
- **Reject:** they stay.
- **Lean:** ratify the units; keep the binding hints, which explain what a λ binds.
