---
title: "A list output that can hold any kind of value can be wired into a table input"
proposed_ring: C
ask: human
date: 2026-09-24
parents:
  - "[[C10]]"
---
## Decision

A list output that may hold mixed values (numbers, text, dates) connects to a table input and is read as a one-column table. Today it can't be wired there, while the even looser output that may be a single value or a list can. After, both wire in.

## Why

A review of how values connect found the difference. A test marks it as intended, but nothing written says why.

## What ratifying means

- **Lean:** None firm. Connecting looks like the consistent choice unless you remember a reason for the difference.
- **Ratify:** The list wires into table inputs as a one-column table.
- **Reject:** Nothing changes on screen, and the connection rules gain a line giving the reason.
