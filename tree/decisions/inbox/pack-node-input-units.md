---
title: "A pack node declares the unit each physical input and output uses"
proposed_ring: D
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[C25]]", "[[D42]]"]
---
## Decision

A custom-logic pack node declares each physical input's unit, as a map from input key to unit id (altitude `m`, frequency `Hz`, temperature `°C`). The arrival coercion converts a dimensioned cell into that unit. A dimension mismatch is `#UNIT!`, and a bare number is read as already in that unit. Outputs declare their unit through `annotationFor`, as Triangle Solver and Element already do.

## Why

Only Triangle Solver is `unitAware`. Every other pack node reads a tagged input at its display magnitude, so the answer is silently wrong:

- Standard Atmosphere reads "2 km" as 2 m.
- EM Spectrum reads "5 GHz" as 5 Hz and "532 nm" as 532 m.
- Pipe Roughness reads "0.1 m" as 0.1 mm.
- Parallel Combine sums kΩ and Ω as raw numbers.

The formula surface strips cells to base SI instead, so STANDARDATMOSPHERE and the card disagree on the same input ([[C17]] shareImpl). Outputs are bare except for Triangle Solver's angles, so K, Pa, Hz and mm go downstream as plain numbers. That contradicts the flagship unit story ([[C25]] firstClassUnits). A per-input declaration keeps [[D42]] perInputUnitBlind's central strip: the strip converts instead of discarding the unit.

**Owner's call:** build the declared-unit coercion for pack nodes now, or park it with the pack distribution work?
