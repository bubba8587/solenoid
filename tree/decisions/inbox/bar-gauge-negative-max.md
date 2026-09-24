---
title: "A Bar gauge with a Max below 0 draws a reversed 0-to-Max track"
proposed_ring: D
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[D75]]"]
---
## Decision

A Bar gauge whose Max is below 0 keeps the track running from 0 on the left to Max on the right, so the fill grows as the value goes more negative (a value of -25 against Max -50 fills half), and a value above 0 draws no fill.

## Why

Today's `BulletBar` already does this: the scale reads "0 ... -50" and the fill is `(value - 0) / (Max - 0)` clamped to the track. It is coherent for a budget-style "how far below zero" reading but surprising for a signed quantity. **Owner's call:** keep the reversed track; or draw the track from Max on the left to 0 on the right with the fill growing leftward from 0; or refuse a Max below 0 (the gauge shows the empty frame with a dash). A Max of exactly 0 currently draws a 0-to-0 track with a unit-wide fill scale and needs the same ruling.

## What ratifying means

- **Ratify (keep the reversed track):** nothing changes on screen. A negative Max reads as "how far below zero", and the scale shows 0 on the left.
- **Flip the track:** the scale reads Max on the left and 0 on the right, and the fill grows leftward from 0, the way a signed number line reads.
- **Refuse:** a Max at or below 0 shows the empty frame with a dash until you fix it.
- **Lean:** flip the track. A signed quantity on a number line is what most people expect, and it covers Max = 0 as an empty track.
