---
title: "A temperature difference converts by scale alone, never by the offset"
proposed_ring: D
ask: human
date: 2026-09-28
parents:
  - "[[C25]]"
---
## Decision

A temperature difference (two readings subtracted, or a spread such as STDEV, AVEDEV or MAX − MIN over readings) stays a difference when it is converted or given a °C or °F display: it converts by the scale alone, so 10 K reads 10 °C or 18 °F, never −263.15 °C.

## Why

[[C25]] firstClassUnits already turns `30 °C − 20 °C` into a difference, 10 K, and drops the affine display so it can't be mistaken for a reading. But the cell that carries it (temperature, no display) is the same cell an absolute kelvin reading is, so the Convert node and the FC put the °C offset back on it: the difference reads −263.15 °C, and in °F −441.67 °F instead of 18 °F. Nothing warns. A difference is the usual thing to convert (a range, a spread, a change), so this is the wrong answer on the common path. Kelvin itself has no offset, which is why the gap never shows until a °C or °F display is asked for.

## What ratifying means

- **Ratify:** a unit cell marks a temperature difference (a flag the subtraction and the spreads set, and any sum or scale of differences keeps); Convert and the FC display it by scale, as Δ°C or Δ°F, and a difference added to a reading gives a reading as today. Frames carry the same mark on the column unit, so GROUPBY's spreads convert right.
- **Reject:** a displayless temperature stays ambiguous, and Convert or the FC refuse to put an offset display on one ("Is this a difference or a kelvin reading? Convert the reading, not the difference"), which also refuses a legitimate kelvin reading.
- **Variant:** only the display side changes: the Δ units (Δ°C, Δ°F) join the unit table as scale-only units, and a difference shows in them by hand, with no automatic marking.
- **Lean:** ratify. The marking is set in the few places a difference is born (subtraction of readings and the spreads, `aggUnitPlan` for frames), and every other path already treats the cell as linear.
