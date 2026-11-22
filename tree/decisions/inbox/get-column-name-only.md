---
title: "Get Column's text field reads a column name only; a position gets its own input"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-11-21
parents: []
---
## Decision

Get Column's text field means a column name and nothing else. Today a name match wins, and failing that, digits read as a 1-based position: "2" typed where no column is named "2" quietly reads the second column, and renaming a column to "2" quietly changes which column an existing card reads.

## Why

One text field shouldn't carry two meanings. Solenoid is built so that a wrong answer can't pass quietly, and this one can. A position belongs on its own number input, or on an option.

## What the try showed (2026-11-21, reverted)

- A name-only lookup on the card moves 6 of Get Column's 247 frozen answers: a frame typed "1" or "2", a lazy frame typed "2", and a bare value (read as one column, `Col1`) typed "1". Each one becomes `#REF!` "column "2" not found; the table has …".
- No seed's Get Column card is typed with a position.
- The same name-or-position rule lives in four places, not one: `frame::get_column` (the lazy-frame reads behind every verb, and the formula engine's `getColumn`), `column_named` (Get Column, and verb sources with `by_position`), Nest Join's `card_column`, and `refs::column`. Making only Get Column's own path name-only also moved 6 SUMIFS answers, because SUMIFS reads a lazy frame's column through `refs::column`. Either the whole rule changes or each card gets told apart on purpose.
- The Cube branch of Get Column already reads names only, so the card answers a frame and a cube with the same columns differently.

## What ratifying means

- **Lean:** Ratify, card by card: Get Column, Nest Join and the SUMIFS family read names only, Get Column gains a Position number input, and the shared helper drops the digit fallback.
- **Ratify:** a card typed "2" today answers `#REF!` until it is retyped with the column's name or moved to Position. Every frozen answer that relied on it is refrozen.
- **Reject:** keep the fallback, and say on the card that digits read as a position when no column has that name.
