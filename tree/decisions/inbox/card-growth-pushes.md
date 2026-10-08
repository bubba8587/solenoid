---
title: A card that grows pushes its neighbors like a group expand
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C112]]"
---
## Decision

Expanding a collapsed card, and a card growing with its live content, pushes neighbors clear the way group expand does.

## Why

Today both can cover neighbors; content growth was left alone on purpose because it can happen on every recompute. **Owner's call:** push on card expand only, on content growth too, or neither?

## What ratifying means

- **Push on expand only:** clicking a collapsed card open moves its neighbors clear, as opening a group does. Live content that grows (a table filling in, a chart resizing) still covers neighbors.
- **Push on content growth too:** nothing is ever covered, but cards can shift on a recompute you didn't trigger, such as a live source refreshing.
- **Neither:** today's behavior stays and [[C112]] names both as exceptions.
- **Lean:** expand only. Cards jumping on their own during a recompute would be worse than an overlap you can see and fix.
