---
title: "Collapsed solver cards show one pill, and settings hide when a card is collapsed"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B14]]"
---
## Decision

Some cards don't follow the collapsed-card rules yet. The solver cards (TVM, Compound Growth, Effective Rate, Triangle Solver, Ohm's Law, dBm/W, Wavelength/Frequency, Ideal Gas, Moles/Mass, pH) collapse to a row per variable; after, they show one pill, the rounded badge a collapsed card shows for its cables. Expect, Grid Painter, Curve, Point Plotter, RANDARRAY, Color, Resistor Code and Query's buttons keep showing settings when collapsed; after, those hide.

## Why

The rule says a collapsed card shows one pill, but on a solver card every variable is both an input and an output.

## What ratifying means

- **Lean:** Ratify for the settings. Decide the solver cards together with the note on solver cards showing only the value they solve for.
- **Ratify:** Every listed card follows the collapsed-card rules.
- **Reject:** Solver cards become an exception and keep a row per variable.
