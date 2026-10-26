---
title: "Opening a collapsed card pushes its neighbors aside, as opening a group does"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C112]]"
---
## Decision

Expanding a collapsed card moves nearby cards clear, the way expanding a group does. Today, opening a collapsed card can cover the card below it. After, that card slides out of the way. A card that grows by itself with live content (a table filling in, a chart resizing) can still cover its neighbors.

## Why

Both kinds of growth can cover neighbors today. Growth from live content was left alone on purpose, because it can happen on any recalculation.

## What ratifying means

- **Lean:** Ratify. Cards jumping on their own during a recalculation would be worse than an overlap you can see and fix.
- **Ratify:** Opening a collapsed card moves its neighbors clear; live content can still cover them.
- **Reject:** Nothing pushes, as today, and the no-overlap rule names both as exceptions. The other option is to push on content growth too: nothing is ever covered, but cards can shift when a live source refreshes.
