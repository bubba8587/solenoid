---
title: "A Pivot keeps a field whose column leaves its source, flagged"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C127]]"
---
## Decision

A Pivot keeps a field whose column is briefly absent, flagged in Configure Fields, instead of dropping it.

## Why

The card drops it (meant for a source swap), so a column briefly absent loses the layout.

## What ratifying means

- **Ratify:** the field stays, marked missing.
- **Reject:** it is dropped.
- **Lean:** ratify: B12 keeps what the user set.
