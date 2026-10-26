---
title: "IronCalc checks Excel parity in the tests"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B16]]"
---
## Decision

Add `ironcalc_base` as a dev-dependency to check PRICE, YIELD, the COUP* functions, WORKDAY and kin against Excel's answers.

## Why

There is no Excel in CI; IronCalc follows Excel and builds for wasm. It would not ship.

## What ratifying means

- **Ratify:** a parity test runs those functions against IronCalc.
- **Reject:** parity stays measured against Formula.js's frozen answers only.
- **Lean:** ratify.
