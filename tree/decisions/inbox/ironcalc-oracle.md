---
title: "The tests check Excel's bond and workday functions against IronCalc"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B16]]"
---
## Decision

Add IronCalc, an open-source spreadsheet engine that follows Excel, to the tests only, to check PRICE, YIELD, the COUP functions, WORKDAY and similar against Excel's answers. It never ships in the app. Today those functions are checked only against answers recorded from Formula.js, the library Solenoid's answers were first matched to. After, a second check compares them with an engine built to match Excel.

## Why

There is no Excel in the automatic test runs.

## What ratifying means

- **Lean:** Ratify.
- **Ratify:** A test compares those functions with IronCalc, and a mismatch shows up as a failing test.
- **Reject:** They stay checked against Formula.js's recorded answers only.
