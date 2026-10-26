---
title: "Three cards with awkward automatic names get proper ones"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[D22]]"
---
## Decision

Some card titles come straight from internal code names and read badly. "IFError" becomes "If Error". "Mat Det" (the card for MDETERM, MINVERSE, TRACE, NORM and MATRIXRANK) gets a family name, perhaps "Matrix". "MRound" (MROUND, CEILING, FLOOR) gets a name too. Automatic naming also learns acronyms and hyphens, so "Url Encode" becomes "URL Encode" and "ESeries" becomes "E-Series".

## Why

Cards are titled from their code name, and these come out awkward.

## What ratifying means

- **Lean:** Ratify "If Error" and the acronym rule; you pick the other two names.
- **Ratify:** You pick two names, the cards rename, and the example graphs update.
- **Reject:** The names stay as they are.
