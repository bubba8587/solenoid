---
title: "With Add missing on and no key list, Write Properties adds no blank properties to notes"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[B1]]"
---
## Decision

With Add missing on, Write Properties (the card that writes table columns into notes' properties) adds a blank property only for the keys named in its key list. Today, with the list empty, writing a `status` column also adds a blank `status:` to every note it writes to that lacks one. After, it adds none until you list `status`.

## Why

An empty key list currently means every written column, so one write can touch every note in a folder, which is hard to undo in Obsidian.

## What ratifying means

- **Lean:** Ratify. A folder-wide blank-property write is the kind of change that is hard to undo.
- **Ratify:** Blank properties appear only for keys you name in the list.
- **Reject:** An empty list keeps adding a blank property for every written column to every note that lacks it.
