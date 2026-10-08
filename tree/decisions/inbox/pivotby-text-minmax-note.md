---
title: PIVOTBY's text min and max are recorded as a deliberate difference from Excel
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[D76]]"
---
## Decision

The PIVOTBY card is marked `parity: false` with a note that min and max over text give the alphabetical first and last ([[D76]] textMinMax), where Excel ignores text.

## Why

The catalog still says `parity: true`, and a `NODE_EXCEL` entry can't carry the note because PIVOTBY isn't a formula function. **Owner's call:** note it in the card description (a UI string under DESIGN.md §7), or somewhere else?

## What ratifying means

- **Ratify:** the PIVOTBY card's catalog entry becomes `parity: false`, and its description gains one sentence saying min and max over text give the alphabetical first and last, where Excel ignores text.
- **Somewhere else:** only the Function Reference or a spec carries it, and the card description stays as is.
- **Lean:** ratify. The description is where you'd look when a result surprises you.
