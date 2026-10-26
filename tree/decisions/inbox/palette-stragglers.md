---
title: "The last hard-coded colors follow the app's palette"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B14]]"
---
## Decision

A few colors still ignore the palette you pick in Settings: the lasso selection, the decorative cable flourish animation, the conduit stripe, the gray-blue accent on the Image, File Link and SVG Picker cards, and the gray of bundled cables. Today they look the same under every palette. After, each takes a palette color, so switching to, say, Solarized changes them too.

## Why

A sweep found them. Some may be on purpose: the conduit stripe is vermilion, an error-like red, but means no error.

## What ratifying means

- **Lean:** Ratify all but the conduit stripe, which needs its own call.
- **Ratify:** Each of these colors follows the palette.
- **Reject:** They stay fixed.
