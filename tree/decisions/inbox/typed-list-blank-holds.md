---
title: "A blank field in a typed list literal is a blank item"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B17]]"
---
## Decision

`1,,3` typed into List Input reads `[1, null, 3]`, as `1,x,3` does and as a wired blank stays in place.

## Why

Today empty fields drop (`[1, 3]`), so a typed list and a wired one disagree about blanks.

## What ratifying means

- **Ratify:** a typed gap is kept as a blank.
- **Reject:** empty fields keep dropping.
- **Lean:** ratify: B17 keeps a value's shape.
