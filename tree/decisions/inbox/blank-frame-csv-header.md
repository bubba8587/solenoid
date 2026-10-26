---
title: "A blank frame's CSV view starts without a blank header"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B19]]"
---
## Decision

A blank frame's CSV view opens empty, so a pasted CSV's header becomes the header.

## Why

Today it starts with a blank header line, so a pasted CSV's header becomes the first data row; the author held the behavior until a change is shown rigorous.

## What ratifying means

- **Ratify:** the CSV view of a blank frame has no header line.
- **Reject:** it stays.
- **Lean:** ratify, with a test of paste into a blank frame.
