---
title: "A computed column infers its unit from the formula"
proposed_ring: D
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[C25]]", "[[D43]]"]
---
## Decision

A computed column with no authored unit takes the unit its formula works out (`dimEval`, as Expression does): `@price * @qty` over a $ column is $, `@hi - @lo` over °C readings is K, `(@lo + @hi) / 2` is °C. An authored unit still wins, and a clash with it is `#UNIT!`.

## Why

Today a computed column reads its cells as bare numbers and carries only the unit someone typed, so `@dist / @time` over km and h is a plain number, and a unit silently drops at the one place a table does arithmetic. Only the affine refusal (a sum of °C readings is `#UNIT!`) reads the source units now, which makes °C the odd one out. Inference would also stop an authored "°C" label from sitting on a column that is really a difference in kelvin. The cost is a dimension pass per formula column and a rule for when inference and the authored unit disagree. **Owner's call:** should computed columns infer their unit, or stay authored-only?
