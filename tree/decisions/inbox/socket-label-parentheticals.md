---
title: "Units in parentheses leave socket labels and move to the Inspector"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B14]]"
---
## Decision

Socket labels drop their notes in parentheses, and the text moves to the Inspector, the side panel that describes each socket. That covers units, such as "T (K)", "(UTC)" and "Marker size (px)", and the hints on function inputs, such as "Values (value)", which say which name a lambda (a formula you hand to another function) receives. Math notation stays. Today a card reads "T (K)"; after, "T", with the unit in the Inspector.

## Why

You asked for the sweep. The function-input hints are a written exception to the label rule, so moving them changes that rule.

## What ratifying means

- **Lean:** Ratify the units; keep the function-input hints, which explain what a lambda receives.
- **Ratify:** Labels lose all their parentheses, and the exception goes.
- **Reject:** The parentheses stay.
