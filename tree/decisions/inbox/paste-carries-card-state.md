---
title: A pasted card carries its pins, comments and standoffs, as a pasted composite's inner cards do
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[B12]]"
---
## Decision

Copy and paste carries a card's pins, its comments, and the standoffs between two copied cards, the same state a composite already carries for its inner cards.

## Why

A plain card now pastes with its size, collapse, flip and frame column formats, which are the card's own look. Pins, comments and standoffs are notes about one spot on the canvas, so a copy may or may not want them. A pasted composite keeps all of them for its inner cards today, so plain cards and composites disagree. **Owner's call:** which of these should a paste carry?

## What ratifying means

- **Ratify:** a paste brings the copied cards' pins and comments, and any standoff between two copied cards. Pasting a card twice gives two pinned copies with the same comments.
- **Reject:** a paste leaves pins, comments and standoffs behind. For consistency a pasted composite's inner cards drop them too, so a composite pasted from a note-heavy model arrives without its notes.
- **Variant:** carry comments and standoffs, and leave pins behind, because a pin marks the one card you are watching.
- **Lean:** ratify. A copy that looks the same as the source but loses its comments is the surprise, and one rule for plain cards and composites is simpler. The change is one line in `pastedSideTables` (`copyPaste.ts`).
