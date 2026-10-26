---
title: "The last hard-coded hues follow the palette"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B14]]"
---
## Decision

The lasso colors, `CableFlourish.tsx`'s Okabe-Ito list, the conduit stripe, the slate `--node-accent` on Image, File Link and SVG Picker, and the ribbon gray take palette tokens.

## Why

Each is a hard-coded hue that ignores the palette (2026-10-02 sweep); some may be deliberate (the conduit stripe is vermilion but not an error).

## What ratifying means

- **Ratify:** each picks a palette token.
- **Reject:** they stay fixed.
- **Lean:** ratify all but the conduit stripe, which needs its own call.
