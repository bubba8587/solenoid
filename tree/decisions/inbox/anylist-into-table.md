---
title: An anylist output may or may not feed a concrete matrix input
proposed_ring: C
ask: human
date: 2026-09-24
parents:
  - "[[C10]]"
---
## Decision

Decide whether an `anylist` output can connect to a `table` (matrix) input. Today it cannot, while the wider `anycombo` output can; `socketConnect.test.ts` pins the asymmetry as intended.

## Why

Found by the value-model review. **Owner's call:** is the asymmetry intended (then this becomes a Consequence on [[C10]] with its reason), or should anylist → table connect like anycombo?

## What ratifying means

- **Ratify connecting:** a list-of-anything output wires into a matrix input and is read as a one-column table, the same way the wider anycombo output already is. The pinning test in `socketConnect.test.ts` flips.
- **Ratify the asymmetry:** nothing changes on screen; [[C10]] gets a line giving the reason.
- **Lean:** none yet. The test calls the asymmetry intended but no node or spec says why, so connecting looks like the consistent choice unless you remember a reason.
