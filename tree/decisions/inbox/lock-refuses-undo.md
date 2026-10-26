---
title: "Undo and Redo do nothing while the canvas is locked"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[B3]]"
---
## Decision

While the canvas is locked, Undo and Redo do nothing, like every other edit. Today, with the canvas locked, Ctrl+Z still changes the graph. After, it does nothing until you unlock.

## Why

The lock blocks adding, rotating, grouping, Tidy and the Add menu, but Undo and Redo still change the graph under it.

## What ratifying means

- **Lean:** Ratify. Unlocking to undo is one click, and a lock that can be walked back is not much of a lock.
- **Ratify:** The lock fully freezes the graph.
- **Reject:** Undo still works while locked, so you can back out a slip made just before locking, but the lock no longer means nothing changes.
