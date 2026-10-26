---
title: "In the Cards view, a cell holding a list or table shows a preview, not just a button to open it"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C114]]"
---
## Decision

In a table popup's Cards view (each row drawn as a card), a cell holding a nested list, table or Cube shows a preview, such as its first few names, a tiny table, or a count, instead of only the chip that opens it. Today a row with an Orders table shows just the chip. After, it could show "12 orders".

## Why

You asked for it on 10-05. The layout is a design call, and the rules for how Cards lays out a row need writing first.

## What ratifying means

- **Lean:** Ratify, starting with counts, which need no layout.
- **Ratify:** Example layouts are explored and the rules written before building.
- **Reject:** Cards keep the chip only.
