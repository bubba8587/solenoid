---
title: "Swap hand-written core code for the crates the audit found"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C130]]"
---
## Decision

Adopt the crates in `docs/audits/crate-audit-2026-10.md`: those with the same answers (`unicode-normalization`, `unicode-general-category`, `strum`, `jiff` for the day helpers, `strsim`, `fastrand`/`uuid`) and, separately, the ones that change answers (`statrs` for the distributions, `libm`/`puruspe` for Bessel).

## Why

Each row's evidence is a bit-for-bit comparison. The same-answer swaps trade size or build deps for less code; the others trade Formula.js parity for accuracy (C14).

## What ratifying means

- **Ratify:** the listed swaps land, each with its comparison as the test.
- **Reject:** the hand-written code stays.
- **Lean:** ratify the same-answer swaps except `unicode-normalization` (+35 KB gzipped); hold the answer-changing ones until parity versus accuracy is ruled.
