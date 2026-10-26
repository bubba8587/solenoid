---
title: "In a Schedule, a Duration of 2 days means 2 working days, as in Microsoft Project"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C70]]"
  - "[[D66]]"
---
## Decision

In the Schedule, a Duration in days or weeks counts working days and working weeks. Today `2 day` converts through hours to 48 hours, which an 8-hour-a-day calendar spreads over 6 working days. After, `2 day` is 2 working days and `1 week` is 5.

## Why

Nobody who types 2 days into a plan means 6 working days. Found in a review of the charts.

## What ratifying means

- **Lean:** Ratify. It is how Microsoft Project reads days and weeks.
- **Ratify:** `2 day` is 2 working days and `1 week` is 5 working days.
- **Reject:** `2 day` stays 48 hours, spread over 6 working days.
