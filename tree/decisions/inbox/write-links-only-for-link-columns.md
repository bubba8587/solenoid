---
title: "Write Properties turns text into a note link only in a column that holds links"
proposed_ring: D
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[B1]]", "[[B17]]"]
---
## Decision

Write Properties writes a text cell as a note link only when its column is a link column (typed as links, or read from a property that held links). Plain text that happens to match a note's name stays plain text.

## Why

Today any text cell matching a note's path or name becomes a link (`noteNamesOf`), so `project: Kitchen remodel` turns into a link to the Kitchen remodel note on the next write. It is documented as a feature. **Owner's call:** keep linking every column, or only link columns?

## What ratifying means

- **Ratify:** a plain text value like `Kitchen remodel` stays plain text in the note's properties even when a note has that name. Only columns typed as links, or read from a property that held links, write links.
- **Reject:** any value that matches a note name keeps becoming a link on the next write.
- **Lean:** ratify. Turning plain text into a link changes the note in a way you didn't ask for, and you can't tell which values will match.
