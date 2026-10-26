---
title: "A Script that uses random numbers or the clock keeps its result until you press F9"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[D46]]"
---
## Decision

A Script card whose code uses `Math.random`, `Date.now` or similar keeps its last result until you press F9 or its Recalculate button, like RAND and the random cards. Today any recalculation that reaches the Script (a load, or an upstream edit that leaves its inputs the same) rolls new random numbers. After, they stay until you ask for new ones.

## Why

Every built-in random source holds still until F9, so a simulation built on a Script can't be repeated today. The catch: it changes what your own code sees.

## What ratifying means

- **Lean:** Ratify. It matches every other random source, and the Recalculate button already exists.
- **Ratify:** A Script gives the same numbers until F9; a script showing the time shows a stale time until F9.
- **Reject:** A Script re-runs whenever the app recalculates, written down as an exception for your own code.
