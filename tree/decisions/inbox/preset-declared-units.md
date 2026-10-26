---
title: "A ready-made pack formula converts wired values into the units it expects"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C25]]"
---
## Decision

Each pack formula preset (a ready-made formula, such as the Thermo pack's dew point) states the unit each physical input is read in. A wired value is converted first, a bare number is taken as in that unit, and a wrong kind is #UNIT!. Before this, the Magnus vapor-pressure preset fed 293.15 K computed as if it were 293.15 °C. It is built and rolled out to every physical preset whose unit the app knows; a few (coulomb, farad, mAh, bpm) wait. Result units are the next step.

## Why

Without it, a preset computes on whatever arrives, and its built-in constants mislabel the answer when units are wired.

## What ratifying means

- **Lean:** Ratify. It pairs with the low-priority item on variable definitions, which fills the same pack entries.
- **Ratify:** It stays; wiring 5 km into escape velocity gives the right answer, and result units come next.
- **Reject:** You name another approach, and the declarations are replaced.
