---
title: "The Range card checks a date against date bounds"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B17]]"
---
## Decision

Range's Min and Max take the same kind of value as the value being checked, so a date is checked against dates. Today, to check whether a date falls in 2026 you type the bounds as date serial numbers (46023 and 46387). After, you wire in 1-Jan-2026 and 31-Dec-2026.

## Why

Min and Max are number inputs today.

## What ratifying means

- **Lean:** Ratify. Bounding a date by its serial number is a spreadsheet habit the app otherwise avoids.
- **Ratify:** A date value takes date bounds, the way a number takes number bounds.
- **Reject:** Range stays numeric, and a date is checked by its serial number.
