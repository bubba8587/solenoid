---
title: "Three cards gain the formula options they lack, and three others point to a card that already does the job"
proposed_ring: E
ask: human
date: 2026-09-24
parents:
  - "[[D73]]"
---
## Decision

Every option a formula takes should be on its card too. Build three: WORKDAY and NETWORKDAYS cards take a weekend pattern like "0000011" (today only a number code), CONCAT rows take a list, and TEXTJOIN gets more than one text row. For three others, another card in the same menu does it: RANDARRAY's rows by columns, FILTER's include mask and if_empty (Frame Filter), and XLOOKUP over plain lists (Frame from Lists). Later finds of the same kind: VDB, IRR, XIRR, SLUGIFY, TEXTSPLIT.

## Why

The rule lets a card lack a formula option only when it is a spreadsheet-grid idea or the formula lacks it too. None of these fits.

## What ratifying means

- **Lean:** Ratify as written.
- **Ratify:** Three cards grow, and the rule gains a third reason a card may lack an option.
- **Reject:** Build all six, which duplicates Frame Filter and Frame from Lists and gives List Filter a second job.
