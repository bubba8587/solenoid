---
title: "Custom packs load from the folder shown in Settings"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B11]]"
---
## Decision

Settle the file format for a custom pack (your own set of cards and formulas, like the built-in Thermo pack) and how the app reads the folder Settings already shows. Today Settings names a custom packs folder, but nothing in it loads. After, a pack saved there shows its cards in the Add menu.

## Why

Loading waits on file access and on a format nobody has written down yet.

## What ratifying means

- **Lean:** Write the format down first, then build.
- **Ratify:** A format is written and built, and packs in the folder load.
- **Reject:** Custom packs stay unbuilt and the folder does nothing.
