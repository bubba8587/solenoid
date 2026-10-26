---
title: "A kelvin value next to a °C reading counts as a temperature reading, not a temperature change"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C25]]"
  - "[[D40]]"
---
## Decision

Next to a °C or °F reading, a kelvin value counts as an absolute temperature, on the Arithmetic card and in formulas. Then `300 K - 20 °C` is a difference, and `20 °C + 300 K` is #UNIT!, since two readings can't be added. Today the card treats kelvin as a change, so `20 °C + 300 K` gives 320 °C, and formulas have no rule.

## Why

Kelvin is used both ways: as an absolute temperature, and as the unit of a change (a subtraction's result shows in K).

## What ratifying means

- **Lean:** Ratify. One catch: a K result from subtracting two readings, added back to a reading, has to count as a change. That case needs its own rule under any option, so say which you expect.
- **Ratify:** The card and formulas both treat K as a reading.
- **Reject:** K counts as a change on both (`20 °C + 300 K` adds 300 degrees); or any mix of K with a °C or °F reading is #UNIT! and you convert first.
