---
title: "The palette is authored for wide-gamut displays"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B14]]"
---
## Decision

Author the accents in `color(display-p3 …)` with sRGB fallbacks, so managed engines on P3 panels show the vivid look the author tuned by eye.

## Why

The hexes are sRGB; WebKitGTK stretches them to the panel, managed Chromium shows them accurately, and the author prefers the vivid look. `palette.ts` derives siblings in HSV from hex, so this is not a token swap.

## What ratifying means

- **Ratify:** the palette gains P3 values.
- **Reject:** sRGB stays.
- **Lean:** leave it until a managed P3 screen is the main one.
