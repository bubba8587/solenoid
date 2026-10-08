---
title: A volatile Script holds its result until F9, as D46 asks of every random node
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[D46]]"
---
## Decision

A Script whose source `scriptIsVolatile` flags (`Math.random`, `Date.now`, `crypto.randomUUID` and the rest) keeps its last result while its arguments and the recalc generation are unchanged, so it re-rolls on F9 or its Recalculate button and not on every recompute pass. The alternative is an exception under [[D46]] freezeVolatilePerCalc: a Script is user code, and it re-runs whenever the engine asks.

## Why

The Script card runs the worker on every `data()` call. Any pass that reaches it (a load, a full pass, an upstream edit that leaves its inputs as they were) redraws its random numbers, which is what [[D46]] forbids for the built-in random nodes: F9 stops being what controls re-rolling, and a Monte Carlo built on a Script can't be reproduced. The freeze is cheap to build, since `scriptIsVolatile` already exists and drives the Recalculate button. It is the owner's call because it changes what a user's own code sees: a script that reads `Date.now()` would show a stale time until F9. **Owner's call:** freeze a volatile Script per recalc, or record the Script as an exception under D46?

## What ratifying means

- **Ratify (freeze):** a Script using `Math.random` or `Date.now` keeps its result until you press F9 or its Recalculate button, like RAND and the random cards. A Monte Carlo built on a Script gives the same numbers until you ask for new ones; a script showing the time shows a stale time until F9.
- **Exception:** the Script re-runs on every pass that reaches it, and [[D46]] gains a named exception for user code.
- **Lean:** freeze. It matches every other random source, and the Recalculate button already exists for the fresh roll.
