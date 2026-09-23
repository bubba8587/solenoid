---
title: "A locked canvas refuses Undo and Redo"
proposed_ring: D
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[C43]]"]
---
## Decision

While the canvas is locked, Undo and Redo do nothing, like every other edit.

## Why

The lock now blocks adding, rotating, grouping, Tidy and the Add menu, but Undo and Redo still change the graph under it. **Owner's call:** block them, or keep undo as the way out of a mistake made before locking?
