---
title: "The canvas dots look softer on the Linux desktop app"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B14]]"
---
## Decision

On the Linux desktop app, the canvas background dots use a softer color or a slightly larger dot, the way the zoom fixes there are already set for that engine. Today the dots look harsher on Linux than in Chrome. After, they look about the same.

## Why

The Linux desktop app's web engine draws tiny circles with harsher edges than Chrome does.

## What ratifying means

- **Lean:** Ratify.
- **Ratify:** The Linux app gets its own dot setting.
- **Reject:** One dot look everywhere.
