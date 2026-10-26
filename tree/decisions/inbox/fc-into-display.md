---
title: "The Format Controller card is folded into the Display card and the input cards"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C25]]"
---
## Decision

Format and unit are set where a value starts (Number, Date, Text and list inputs) or where it is shown (the Display card), and flow downstream only. The Format Controller, the separate card that sets how a number is shown and in what unit, goes away. Today you dock a Format Controller onto a card and it formats the box behind it. After, you set the format on the input or a Display and everything downstream inherits it.

## Why

You proposed this and marked it for later, until you'd lived with downstream-only formatting and the control on input cards was designed.

## What ratifying means

- **Lean:** Wait for your go.
- **Ratify:** The Format Controller and its docking go, its popup moves to the Display and input cards, and example graphs using it are reworked.
- **Reject:** The Format Controller stays.
