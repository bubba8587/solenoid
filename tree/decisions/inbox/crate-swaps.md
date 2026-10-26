---
title: "Parts of the calculation engine are replaced with well-known open-source libraries"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C130]]"
---
## Decision

Replace hand-written engine code with open-source libraries an audit found, in two groups. Same answers: text normalization, Unicode character categories, date arithmetic, text-distance matching, and random numbers and IDs. Different answers: the statistical distributions such as NORM.DIST (the last digits change, about one part in ten billion) and the Bessel functions (up to about one part in ten thousand, because today's code copies Formula.js's less precise version; Formula.js is the library Solenoid's answers were first matched to).

## Why

Less code to maintain. The first group gives identical answers; the second trades matching Formula.js for accuracy.

## What ratifying means

- **Lean:** Ratify the same-answer group except text normalization, which adds 35 KB to the compressed download. Hold the second group until you rule on matching Formula.js versus accuracy.
- **Ratify:** The swaps land, each tested against a side-by-side comparison.
- **Reject:** The hand-written code stays.
