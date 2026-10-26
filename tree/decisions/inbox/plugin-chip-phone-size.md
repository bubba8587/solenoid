---
title: "The plugin's chip grows on a phone"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B14]]"
---
## Decision

Under `body.is-phone`, the plugin's chip renders `md` (or gets a taller hit area on its button) instead of always `sm`.

## Why

A chip is 15px tall on Obsidian's 41px phone row (measured 2026-09-22), under the "always `sm`" ruling in obsidian-plugin.md.

## What ratifying means

- **Ratify:** the ruling gains a phone exception.
- **Reject:** the chip stays `sm` everywhere.
- **Lean:** ratify the taller hit area: the look stays the same.
