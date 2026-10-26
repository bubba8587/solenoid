---
title: "The PIVOTBY card's description says that min and max over text differ from Excel"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[D76]]"
---
## Decision

The PIVOTBY card is marked as differing from Excel, and its description gains one sentence: min and max over text give the alphabetically first and last, where Excel ignores text. Today PIVOTBY's MAX over a Name column gives "Zoe", which Excel would not, and the card is still marked as matching Excel.

## Why

The Function Reference can't carry the note the usual way, because PIVOTBY isn't a formula you can type.

## What ratifying means

- **Lean:** Ratify. The description is where you'd look when a result surprises you.
- **Ratify:** The card is marked as differing, with one sentence saying how.
- **Reject:** Only the Function Reference or a spec carries the note, and the description stays as is.
