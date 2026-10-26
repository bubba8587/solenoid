---
title: "An average over nothing is blank everywhere, including AVERAGEIF and AVERAGEIFS with no matches"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[D70]]"
---
## Decision

AVERAGE, AVERAGEIF and AVERAGEIFS all give a blank when there is nothing to average. Today AVERAGE of an empty list is blank, but AVERAGEIF with no matching rows is #DIV/0!. After, both are blank.

## Why

The two disagree today. Excel gives #DIV/0! for all three; Solenoid's rule is that not enough data is a quiet blank, not an error.

## What ratifying means

- **Lean:** Ratify, unless you want matching Excel to win here.
- **Ratify:** AVERAGEIF and AVERAGEIFS with no matches go blank, and all three get a note saying they differ from Excel.
- **Reject:** Either #DIV/0! everywhere, matching Excel, so an empty filter upstream shows an error downstream; or today's split stays.
