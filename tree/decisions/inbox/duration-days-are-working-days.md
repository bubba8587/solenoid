---
title: "A Duration in days or weeks counts working days, as Microsoft Project does"
proposed_ring: D
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[C70]]", "[[D66]]"]
---
## Decision

In the Schedule, a united Duration of `day` or `week` means working days and working weeks: 2 days is 2 working days.

## Why

Today a united Duration converts through hours per day, so 2 day becomes 48 hours, which is 6 working days at 8 hours a day. Found by the charts review. **Owner's call:** working days, or calendar hours?
