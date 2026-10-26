---
title: "A blank table's CSV view starts empty, so a pasted CSV keeps its header row"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B19]]"
---
## Decision

When you open the CSV view (editing a table as plain comma-separated text) on a blank table, it starts empty. Today it starts with an empty header line, so pasting `name,age` and some rows makes `name,age` the first data row under blank column names. After, `name,age` becomes the header.

## Why

The blank header line makes every paste into a new table come out one row off. You held the behavior until a change could be shown to be safe.

## What ratifying means

- **Lean:** Ratify, with a test of pasting into a blank table.
- **Ratify:** A pasted CSV's first line becomes the header.
- **Reject:** The CSV view keeps starting with a blank header line.
