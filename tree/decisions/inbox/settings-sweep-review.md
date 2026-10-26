---
title: "The rules for what a blank setting means stand as Claude built them"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[D86]]"
---
## Decision

An earlier sweep decided, input by input, what a blank setting means: the function's default, an error naming the setting, or a condition that is skipped. For example, a blank bound on CLAMP means no bound on that side, and a blank k on LARGE is an error. Those calls stand, and the rest are swept the same way: column choices on table cards, the tolerance on an as-of Join, and the Slider's bounds.

## Why

The sweep was built on Claude's judgment at your word, and you haven't reviewed it. The list is in the settings audit doc.

## What ratifying means

- **Lean:** Review the rows marked decided 2026-09-26, and ratify the rest.
- **Ratify:** The remaining inputs get rules the same way.
- **Reject:** You mark which calls change.
