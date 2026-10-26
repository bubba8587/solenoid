---
title: "IF(x=0, 0, 1/x) answers 0 when x is 0, as in Excel"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[D35]]"
---
## Decision

IF, IFS, SWITCH and CHOOSE, in formulas and as cards, pass up only an error in their test or index; an error in a branch that isn't chosen never reaches the answer. Today `IF(x=0, 0, 1/x)` with x = 0 gives #DIV/0!. After, it gives 0.

## Why

Today every error passes straight through every function, so the most common Excel guard pattern fails.

## What ratifying means

- **Lean:** Ratify. Anyone coming from Excel will write this guard.
- **Ratify:** The guard works in formulas and on the four cards; an error in the test still passes up.
- **Reject:** It stays #DIV/0!, and the guard has to be written `IFERROR(1/x, 0)`.
