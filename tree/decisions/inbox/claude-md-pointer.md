---
title: "CLAUDE.md's registerInternal pointer is reworded"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[D99]]"
---
## Decision

CLAUDE.md's "before touching a `registerInternal` override" reads "before changing a function whose answer differs from Formula.js's".

## Why

The registry is gone (the core's `route` and `data/call_traits.json`); CLAUDE.md is the author's file.

## What ratifying means

- **Ratify:** the author edits the line, or lets an agent.
- **Reject:** it stays stale.
- **Lean:** ratify.
