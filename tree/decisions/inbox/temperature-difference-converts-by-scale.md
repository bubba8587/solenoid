---
title: "A temperature difference of 10 K converts to 10 °C or 18 °F, never -263.15 °C"
proposed_ring: D
ask: human
date: 2026-09-28
parents:
  - "[[C25]]"
---
## Decision

A temperature difference (one reading minus another, or a spread such as STDEV over readings) stays a difference when converted or shown in °C or °F. Today `30 °C - 20 °C` gives 10 K, but showing that in °C gives -263.15 °C, and in °F -441.67 °F. After, it shows 10 Δ°C or 18 Δ°F.

## Why

The result of a subtraction looks like an absolute kelvin reading, so Convert and the Format Controller (the card that sets how a number is shown) add the °C offset back, with no warning.

## What ratifying means

- **Lean:** Ratify.
- **Ratify:** Differences convert by scale; adding a difference to a reading still gives a reading; table spreads such as GROUPBY's convert right too.
- **Reject:** Convert and the Format Controller refuse to show such a value in °C or °F, which also refuses a real kelvin reading; or Δ°C and Δ°F are added as units you pick by hand, with no automatic marking.
