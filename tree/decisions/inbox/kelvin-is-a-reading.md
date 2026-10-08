---
title: A kelvin value beside a °C reading counts as a reading, not a difference
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C25]]"
  - "[[D40]]"
---
## Decision

A value in kelvin is an absolute temperature, so beside a °C or °F reading it counts as a reading: `300 K − 20 °C` is a difference, `20 °C + 300 K` is #UNIT! (two readings added), on the Arithmetic card and in formulas alike.

## Why

Today `arithmeticCell` treats a kelvin cell as linear, so it acts as a difference (`20 °C + 300 K` adds 300 degrees), while a formula has no rule for kelvin beside a reading at all. Kelvin is used both ways in practice: as an absolute temperature and as the unit of a temperature difference (a delta result shows in K). **Owner's call:** is K beside a reading a reading, a difference, or refused as ambiguous?

## What ratifying means

- **A reading:** `300 K − 20 °C` is a difference and `20 °C + 300 K` is `#UNIT!`, on the card and in formulas.
- **A difference:** `20 °C + 300 K` adds 300 degrees on both surfaces, as the card does today.
- **Refused:** any mix of K with a °C or °F reading is `#UNIT!`, and you convert first.
- **Lean:** a reading. Readings subtract to a result shown in K, so a K result added back to a reading has to read as a difference. That case needs its own rule under any of the three options, so say which you expect.
