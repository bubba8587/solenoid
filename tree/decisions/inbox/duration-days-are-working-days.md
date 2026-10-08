---
title: A Duration in days or weeks counts working days, as Microsoft Project does
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C70]]"
  - "[[D66]]"
---
## Decision

In the Schedule, a united Duration of `day` or `week` means working days and working weeks: 2 days is 2 working days.

## Why

Today a united Duration converts through hours per day, so 2 day becomes 48 hours, which is 6 working days at 8 hours a day. Found by the charts review. **Owner's call:** working days, or calendar hours?

## What ratifying means

- **Ratify:** `2 day` on an 8-hour calendar is 2 working days and `1 week` is 5 working days. This is how Microsoft Project reads d and w.
- **Reject:** `2 day` stays 48 hours, which the calendar spreads over 6 working days.
- **Lean:** ratify. Nobody who types 2 days into a plan means 6 working days.
