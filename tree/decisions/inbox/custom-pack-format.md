---
title: "Custom packs load from a folder in a settled format"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B11]]"
---
## Decision

Settle a custom pack's file format and how the app reaches the folder Settings shows (`customPacksFolder()`), so `loadCustomPacks()` stops being a stub.

## Why

Loading waits on filesystem access and a format; once it loads, the Add menu's per-type caches must clear.

## What ratifying means

- **Ratify:** a format is specced and built.
- **Reject:** custom packs stay unbuilt.
- **Lean:** spec the format first.
