---
title: "Solver cards collapse to one pill and settings hide when collapsed"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B14]]"
---
## Decision

Collapsed solver cards (TVM, Ohm's Law, Triangle Solver, Ideal Gas and kin) show one pill rather than a row per variable, and settings hide when collapsed on Expect, Grid Painter, Curve, Point Plotter, RANDARRAY, Color, Resistor Code and Query's buttons.

## Why

`collapse-sweep.mjs` lists them (2026-10-26: TVM, Compound Growth, Effective Rate, Triangle Solver, Ohm's Law, dBm/W, Wavelength/Frequency, Ideal Gas, Moles/Mass and pH collapse with a row per variable and no pill); components § Collapsed says one pill, but solver cards have every variable as input and output.

## What ratifying means

- **Ratify:** the cards follow the collapsed rules.
- **Reject:** solver cards are an exception.
- **Lean:** ratify for settings; decide solver cards with solver-unknown-output.
