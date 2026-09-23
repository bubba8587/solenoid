---
title: "Text passed straight to SUM, AND and friends is #VALUE!, as in Excel"
proposed_ring: D
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[B17]]", "[[A5]]"]
---
## Decision

A text value passed directly as an argument (not inside a range) to an aggregate is #VALUE!: `SUM("a")` and `AND("a", TRUE)` answer #VALUE!, as in Excel. Text inside a range or list is still skipped.

## Why

Today `SUM("a")` is 0 and `AND("a", TRUE)` is TRUE. On the canvas a wired scalar is ambiguous between a direct argument and a one-cell range, so the rule needs a line: a wired scalar counts as direct. **Owner's call:** follow Excel, or keep skipping text?
