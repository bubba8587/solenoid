---
title: Import Obsidian Note shows when its note was renamed or deleted
proposed_ring: E
ask: human
date: 2026-09-24
parents:
  - "[[C23]]"
---
## Decision

When the note behind an Import Obsidian Note card is renamed or deleted, the card shows a status (as the connection cards do) while keeping its last body.

## Why

Today it silently keeps the old body. **Owner's call:** show a status, or stay quiet?

## What ratifying means

- **Ratify:** when the note is renamed or deleted, the card keeps its last body and shows a status line saying the note is gone, like a connection card that has lost its source.
- **Reject:** the card keeps the old body with no sign that it is stale.
- **Lean:** ratify. A stale body that looks live is the kind of silent wrong answer the Obsidian track is meant to avoid.
