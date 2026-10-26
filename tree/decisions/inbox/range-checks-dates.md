---
title: "Range checks a date against date bounds"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B17]]"
---
## Decision

Range's Min and Max adopt the value's family, so a date value is checked against date bounds.

## Why

Min and Max are number sockets, so a date value is range-checked only against typed serials.

## What ratifying means

- **Ratify:** a date value wires date bounds into Range, the way a number does.
- **Reject:** Range stays numeric; a date is checked by its serial.
- **Lean:** ratify. A date that can only be bounded by a serial is a spreadsheet habit the app otherwise avoids.
