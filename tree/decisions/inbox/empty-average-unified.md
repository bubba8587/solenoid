---
title: "AVERAGE of nothing and AVERAGEIF(S) with no matching row give the same answer"
proposed_ring: D
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[D70]]"]
---
## Decision

An average over no values gives one answer on every surface: either blank (as AVERAGE does today, [[D70]]) or #DIV/0! (as AVERAGEIF and AVERAGEIFS do today, and as Excel does for all three).

## Why

The two disagree today. **Owner's call:** blank everywhere, #DIV/0! everywhere, or keep the split?
