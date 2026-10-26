---
title: "IMSUM and the other complex-number functions keep reading numbers written as text"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C131]]"
---
## Decision

IMSUM, IMABS and the rest of the IM family are written down as allowed to read text, because text such as "3+4i" is how Excel writes a complex number. Today `IMABS("3+4i")` gives 5 and `IMSUM("2")` reads "2" as 2. That keeps working.

## Why

Solenoid's rule is that formulas never guess a type from text, but the text form of a complex number is Excel's own habit.

## What ratifying means

- **Lean:** Ratify. It keeps Excel's habit.
- **Ratify:** Nothing changes on screen; the formula rules list the IM family as an allowed exception.
- **Reject:** The IM family refuses text like any other function, and complex numbers come only from COMPLEX or a typed input.
