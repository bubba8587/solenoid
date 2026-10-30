---
title: "Write Properties stops turning text into note links on its own"
proposed_ring: D
ask: human
date: 2026-10-29
parents:
  - "[[B1]]"
---
## Decision

Checked against the code on 2026-10-29. When Write Properties writes a text cell, it writes it as a link whenever the text exactly matches a note's name: a project column holding "Kitchen remodel" becomes `[[Kitchen remodel]]` if that note exists, and plain text if it doesn't. After, text is always written as typed. A link is written only when the cell already holds one, such as `[[Kitchen remodel]]`.

## Why

Whether a value becomes a link depends on which notes happen to exist, so the same write can change a note differently from one day to the next.

## What ratifying means

- **Lean:** Ratify. A write should put down what the cell says.
- **Ratify:** Text stays text; type the brackets to write a link.
- **Reject:** Text matching a note name keeps becoming a link.
