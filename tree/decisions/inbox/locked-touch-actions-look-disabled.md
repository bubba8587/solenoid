---
title: "Touch and tablet actions look disabled while the canvas is locked"
proposed_ring: E
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[C43]]"]
---
## Decision

On a locked canvas the mobile ➕ and the tablet edit actions are drawn disabled (per DESIGN.md), not live-looking buttons that do nothing.

## Why

They now do nothing when locked, with no visual cue. **Owner's call:** dim them, hide them, or leave them?

## What ratifying means

- **Dim:** the mobile ➕ and the tablet edit actions stay in place but look disabled while locked.
- **Hide:** they disappear while locked and come back on unlock; the bar changes shape.
- **Leave:** they look live and do nothing, as today.
- **Lean:** dim. The bar keeps its layout and you can see why nothing happens.
