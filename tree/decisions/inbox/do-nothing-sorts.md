---
title: "SORT and UNIQUE on a list keep Excel's behavior, with the card toggles as the help"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B19]]"
---
## Decision

Nothing more is built. In Excel a list is one row, so SORT or UNIQUE on it changes nothing unless `by_col` is TRUE, and Solenoid matches that: SORT on the list 3, 1, 2 gives back 3, 1, 2. The Sort and UNIQUE cards already have a Rows / Columns toggle, and Columns sorts the list.

## Why

You named three ways to help if needed: card toggles, a separate list-sorting function such as LISTSORT, or an error on a setup that does nothing. The toggles are built.

## What ratifying means

- **Lean:** Ratify.
- **Ratify:** No new function and no new error; the toggles are the way.
- **Reject:** Add a list-sorting function, or make the do-nothing call an error (which you called drastic).
