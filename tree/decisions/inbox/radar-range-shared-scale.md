---
title: "A radar's set range implies a shared scale"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C96]]"
---
## Decision

On a multi-series radar, setting `ymin`/`ymax` switches Scale to shared, so the range does something.

## Why

Under Scale = per axis the range is ignored; a single-series radar honors it. The alternative is documenting it as a C96 exception, as multi-series `color` is.

## What ratifying means

- **Ratify:** a set range is always honored.
- **Reject:** it stays a documented exception.
- **Lean:** ratify.
