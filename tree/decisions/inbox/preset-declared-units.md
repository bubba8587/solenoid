---
title: "A formula preset declares the unit each input is read in"
proposed_ring: D
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[C25]]"]
---
## Decision

A pack formula preset names the unit its correlation reads each physical input in (`units` on the pack entry, `varUnits` on the Expression or Equation node, saved with the node). A wired value converts to that unit before the formula runs, a bare number is taken as already in it, and a value of another dimension is `#UNIT!`. The formula then runs on plain numbers and the result is a bare number. Declared today: the Thermo presets whose inputs are temperatures or the wind-chill speed (Magnus SVP, dew point, RH from dew point, wet bulb and wind chill in °C, heat index in °F, air density, radiation and the ideal-gas equation in K). Every other pack preset is still undeclared.

Open next steps, in order: declare the remaining physical presets (fluids, electricity, electromagnetism, earth and sky, health, chemistry), and let a preset declare its result unit so the answer carries it (today it comes back bare).

## Why

Without a declaration a correlation computed on whatever arrived: a Magnus preset fed 293.15 K computed as if it were 293.15 °C and showed 9.35 MPa, and fed °C it refused with `#UNIT!` because the unit algebra can't see that `243.04` is in °C. Physical presets bake bare constants (R = 287.05, g, G) into their formulas, so the unit algebra also mislabels their result dimension whenever units are wired. A declared input unit is the least mechanism that makes each assumption explicit and enforced. **Owner's call:** keep this mechanism and roll it out to every physical preset, with result units next, or handle presets another way?

## What ratifying means

- **Ratify:** the mechanism Thermo presets use stays, and every physical preset in fluids, electricity, electromagnetism, earth and sky, health and chemistry declares its input units. Wiring `5 km` into escape velocity then gives the right answer. Result units come after that as a second step.
- **Reject:** you name the other approach, and the Thermo declarations get replaced.
- **Lean:** ratify. It pairs with the low-priority variable-definitions item, since both fill the same pack entries.
