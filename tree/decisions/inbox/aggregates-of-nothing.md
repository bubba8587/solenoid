---
title: "MAX and MIN of nothing are blank, and PRODUCT of nothing is 1"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-11-06
parents:
  - "[[C24]]"
---
## Decision

When a list holds no numbers (every cell blank, or empty), MAX and MIN would answer blank instead of 0, and PRODUCT
would answer 1 instead of 0. SUM and COUNT stay 0, and AVERAGE and MEDIAN stay blank, as now. Before: MAX of an
all-blank column shows 0. After: it shows the dash.

## Why

The largest of nothing isn't 0; Excel's 0 is a made-up number of the kind blanks exist to prevent. It also clashes with
Solenoid's own reason for 0^0 = 1, "the empty product is 1", while PRODUCT of nothing is 0.

## What ratifying means

- **Lean:** Ratify: an empty total answers the honest value, or blank where there is none.
- **Ratify:** three functions stop matching Excel on empty input, in formulas and on the cards.
- **Reject:** they keep Excel's 0.
