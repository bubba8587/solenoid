---
title: "Import Obsidian Note says so when its note was renamed or deleted"
proposed_ring: E
ask: human
date: 2026-09-24
parents:
  - "[[C23]]"
---
## Decision

When the note behind an Import Obsidian Note card is renamed or deleted, the card keeps its last body and shows a status line saying the note is gone, as connection cards do when they lose their source. Today it keeps showing the old body with no sign that it is stale.

## Why

A stale body that looks live is a silent wrong answer, the kind the Obsidian work is meant to avoid.

## What ratifying means

- **Lean:** Ratify.
- **Ratify:** A renamed or deleted note shows a status line on the card, with the last body kept.
- **Reject:** The card keeps the old body with no sign that it is stale.
