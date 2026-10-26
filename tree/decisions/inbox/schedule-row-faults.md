---
title: "One bad row in a Schedule marks only that row, instead of failing the whole schedule"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C70]]"
---
## Decision

The Schedule card keeps a bad row's error on that row, as its written rule says. Today one bad Duration or unreadable date makes every output of the card #VALUE!. After, only that row shows the error and the rest of the schedule computes.

## Why

The card and its written rule disagree, so one of them has to change.

## What ratifying means

- **Lean:** Reject, and change the rule to match the card. The error rules already say a failure in the structure is one error, and a partial schedule could mislead.
- **Ratify:** Bad rows show their own errors and the rest of the schedule computes.
- **Reject:** The rule is rewritten to say one bad row fails the whole schedule, as the card does today.
