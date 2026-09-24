---
title: AVERAGE of nothing and AVERAGEIF(S) with no matching row give the same answer
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[D70]]"
---
## Decision

An average over no values gives one answer on every surface: either blank (as AVERAGE does today, [[D70]]) or #DIV/0! (as AVERAGEIF and AVERAGEIFS do today, and as Excel does for all three).

## Why

The two disagree today. **Owner's call:** blank everywhere, #DIV/0! everywhere, or keep the split?

## What ratifying means

- **Blank everywhere:** AVERAGEIF and AVERAGEIFS with no matches go blank like AVERAGE, which keeps [[D70]] nullNotEnoughData (not enough data is a quiet blank, not an error). Differs from Excel for all three, so all three get a parity note.
- **#DIV/0! everywhere:** matches Excel, but reverses [[D70]] for averages, so an empty filter upstream shows an error downstream.
- **Lean:** blank everywhere, unless you want Excel parity to beat [[D70]] here.
