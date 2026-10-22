---
title: A computed column infers its unit from the formula
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C25]]"
  - "[[D43]]"
---
## Decision

A computed column with no authored unit takes the unit its formula works out (`dimEval`, as Expression does): `@price * @qty` over a $ column is $, `@hi - @lo` over °C readings is K, `(@lo + @hi) / 2` is °C. An authored unit still wins, and a clash with it is `#UNIT!`.

## Why

Today a computed column reads its cells as bare numbers and carries only the unit someone typed, so `@dist / @time` over km and h is a plain number, and a unit silently drops at the one place a table does arithmetic. Only the affine refusal (a sum of °C readings is `#UNIT!`) reads the source units now, which makes °C the odd one out. Inference would also stop an authored "°C" label from sitting on a column that is really a difference in kelvin. A wired value with a unit drops the same way (found 2026-10-22): the Computed Column and LAMBDA cards aren't unit-aware, so the compute pass strips `k = 5 km` to its display magnitude before the formula reads it, and `@a * k` is a plain `[5, 10]` with no message. Ratifying covers that too: the column's dimension pass reads its wired values' units as Expression reads its inputs'. The cost is a dimension pass per formula column and a rule for when inference and the authored unit disagree. **Owner's call:** should computed columns infer their unit, or stay authored-only?

## What ratifying means

- **Ratify:** a column like `@dist / @time` over km and h shows km/h without anyone typing it, and a unit you do type is checked against what the formula gives.
- **Cost:** columns that show a bare number today start showing a unit, so a few seeds and saved tables will look different, and a typed unit that contradicts the formula becomes `#UNIT!`.
- **Reject:** units stay typed only, and °C stays the one case that reads source units.
- **Lean:** ratify. It is the same rule Expression already follows, and unit control is a flagship feature.
