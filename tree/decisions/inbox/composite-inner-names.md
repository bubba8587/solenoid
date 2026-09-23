---
title: "A card's name inside a composite is scoped to that composite"
proposed_ring: D
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[C77]]", "[[B12]]"]
---
## Decision

Names given to cards inside a composite belong to that composite: they are saved with it, reload with it, and may repeat a name used on the main canvas or in another composite (as a function's local variables may repeat a global's).

## Why

Today a name given inside a composite isn't saved at all, so it is gone after a reload or a drill-in undo (a lossless-save gap under [[B12]] losslessSaves). Saving it needs a rule first, because names live in one global namespace today, so an inner name could clash with a main-canvas one. The other lost fields (size, collapsed, flipped) are being fixed without waiting on this. **Owner's call:** names scoped per composite, or one global namespace (an inner name must be unique everywhere)?
