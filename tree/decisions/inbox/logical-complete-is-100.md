---
title: "A done checkbox in a Schedule's Complete column reads as 100%"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C70]]"
---
## Decision

In the Schedule, a Complete column holding TRUE and FALSE (such as the done checkbox from TaskNotes, the Obsidian task plugin) reads TRUE as 100% and FALSE as 0%. Today a done task shows 0% on the Gantt. After, it shows 100%.

## Why

Anything other than a number reads as 0 today.

## What ratifying means

- **Lean:** Ratify. TaskNotes is the flagship integration, and its done field is a checkbox.
- **Ratify:** Done tasks show 100% on the Gantt and in progress totals.
- **Reject:** Complete takes numbers only, and a checkbox column has to go through `IF(done, 100, 0)` first.
