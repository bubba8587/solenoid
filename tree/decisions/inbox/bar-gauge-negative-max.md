---
title: "A Bar gauge with a Max below 0 reads like a number line, with Max on the left and 0 on the right"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C96]]"
---
## Decision

A Bar gauge whose Max is below 0 draws its scale from Max on the left to 0 on the right, and the fill grows leftward from 0. With Max at -50, today the scale reads "0 ... -50" and a value of -25 fills the left half. After, it reads "-50 ... 0" and -25 fills the half next to 0. A Max of exactly 0 draws an empty track.

## Why

Today's reversed track suits a budget-style "how far below zero" reading, but surprises anyone showing a signed quantity.

## What ratifying means

- **Lean:** Ratify. A number line is what most people expect, and it also settles a Max of 0.
- **Ratify:** A negative Max reads like a number line, with 0 on the right.
- **Reject:** The reversed track stays as today. The other option is to refuse a Max at or below 0, showing the empty frame with a dash until you fix it.
