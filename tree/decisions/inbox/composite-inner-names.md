---
title: "A card's name inside a composite belongs to that composite"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C77]]"
  - "[[B12]]"
---
## Decision

Names you give to cards inside a composite (a card that wraps a smaller graph you can drill into) are saved with it and may repeat a name used elsewhere. Today, a card you name Total inside a composite loses its name on reload. After, it keeps it, and two composites can each have their own Total.

## Why

Inner names aren't saved at all today. Saving them needs a rule first, because all names share one app-wide list and an inner name could clash with one on the main canvas.

## What ratifying means

- **Lean:** Ratify. It is the only choice under which a copied composite still works without renaming.
- **Ratify:** Inner names save and reload, and a formula inside a composite finds its own Total first.
- **Reject:** Names stay app-wide: inner names save, but an inner Total is refused while the main canvas has one, so a duplicated composite needs every inner card renamed.
