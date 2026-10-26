---
title: "Pack cards convert wired values into the unit each input expects"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C25]]"
---
## Decision

Each pack card with a physical input (such as Standard Atmosphere) states the unit that input uses, such as meters for altitude. A wired value is converted into it, a bare number is taken as already in it, a value of the wrong kind is #UNIT!, and answers carry units. Today Standard Atmosphere reads "2 km" as 2 m and EM Spectrum reads "5 GHz" as 5 Hz, with no warning.

## Why

Only Triangle Solver handles units today, so the other pack cards give silently wrong answers, and their matching formulas disagree with them on the same input.

## What ratifying means

- **Lean:** Ratify now. The wrong answers are silent, and the Thermo formulas already use the same idea.
- **Ratify:** Pack cards read a wired 2 km as 2000 m, answer with units, and refuse a length where a frequency belongs.
- **Reject:** Park it with the pack work; wired km or GHz values keep giving wrong answers until then.
