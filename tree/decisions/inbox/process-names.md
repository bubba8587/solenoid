---
title: "Proper names for the app's processes"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B14]]"
---
## Decision

Name the remaining processes: the Pass, the Dimension Pass, the Type Settle (and `bulkSettle`'s wider sweep), the Rebuild, the Error Guard; and the names floated 2026-10-25 (the Reader / the Formatter, an op queue for a FrameRef's pending ops, sources / transforms / views / writers, popup and preference stores, refusals, ported bodies vs owned functions).

## Why

Proper names keep specs and chat unambiguous (LayoutFx, VaultBridge); "plan" has five meanings today.

## What ratifying means

- **Ratify:** the picked names go into `docs/glossary.md` and the specs.
- **Reject:** the current descriptive phrases stay.
- **Lean:** pick them one at a time; the Pass and the Type Settle are already in use.
