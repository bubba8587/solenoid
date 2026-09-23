---
title: "A kelvin value beside a °C reading counts as a reading, not a difference"
proposed_ring: D
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[C25]]", "[[D40]]"]
---
## Decision

A value in kelvin is an absolute temperature, so beside a °C or °F reading it counts as a reading: `300 K − 20 °C` is a difference, `20 °C + 300 K` is #UNIT! (two readings added), on the Arithmetic card and in formulas alike.

## Why

Today `arithmeticCell` treats a kelvin cell as linear, so it acts as a difference (`20 °C + 300 K` adds 300 degrees), while a formula has no rule for kelvin beside a reading at all. Kelvin is used both ways in practice: as an absolute temperature and as the unit of a temperature difference (a delta result shows in K). **Owner's call:** is K beside a reading a reading, a difference, or refused as ambiguous?
