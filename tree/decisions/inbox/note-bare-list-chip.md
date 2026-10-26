---
title: "A Note card shows a list property as a chip, as Obsidian does"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[D87]]"
---
## Decision

When a Note's body holds a bare `{{ items }}` and `items` is a list or table property, the Note card shows the same chip, the small clickable box for a list or table, that Obsidian shows with the Solenoid plugin. Today the card prints the raw data text, such as `[1,2,3]`, while Obsidian draws the chip.

## Why

The card and Obsidian show the same note differently.

## What ratifying means

- **Lean:** Ratify.
- **Ratify:** The card and Obsidian agree.
- **Reject:** The card keeps printing the raw text.
