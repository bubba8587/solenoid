---
title: "PIVOTBY's text min and max are recorded as a deliberate difference from Excel"
proposed_ring: D
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[D76]]"]
---
## Decision

The PIVOTBY card is marked `parity: false` with a note that min and max over text give the alphabetical first and last ([[D76]] textMinMax), where Excel ignores text.

## Why

The catalog still says `parity: true`, and a `NODE_EXCEL` entry can't carry the note because PIVOTBY isn't a formula function. **Owner's call:** note it in the card description (a UI string under DESIGN.md §7), or somewhere else?
