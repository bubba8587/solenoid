---
title: "An anylist output may or may not feed a concrete matrix input"
proposed_ring: C
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[C10]]"]
---
## Decision

Decide whether an `anylist` output can connect to a `table` (matrix) input. Today it cannot, while the wider `anycombo` output can; `socketConnect.test.ts` pins the asymmetry as intended.

## Why

Found by the value-model review. **Owner's call:** is the asymmetry intended (then this becomes a Consequence on [[C10]] with its reason), or should anylist → table connect like anycombo?
