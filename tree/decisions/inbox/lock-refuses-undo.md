---
title: A locked canvas refuses Undo and Redo
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C43]]"
---
## Decision

While the canvas is locked, Undo and Redo do nothing, like every other edit.

## Why

The lock now blocks adding, rotating, grouping, Tidy and the Add menu, but Undo and Redo still change the graph under it. **Owner's call:** block them, or keep undo as the way out of a mistake made before locking?

## What ratifying means

- **Block:** while locked, Ctrl+Z and the undo buttons do nothing, so the lock fully freezes the graph.
- **Keep:** undo still works while locked, so you can back out a slip made just before locking, but the lock no longer means nothing changes.
- **Lean:** block. Unlocking to undo is one click, and a lock that can be walked back is not much of a lock.
