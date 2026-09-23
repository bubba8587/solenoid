---
title: "Write Properties turns text into a wikilink only in a column that holds links"
proposed_ring: D
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[B1]]", "[[B17]]"]
---
## Decision

Write Properties writes a text cell as `[[Note]]` only when its column is a link column (typed as links, or read from a property that held links). Plain text that happens to match a note's name stays plain text.

## Why

Today any text cell matching a note's path or name becomes a link (`noteNamesOf`), so `project: Kitchen remodel` turns into `"[[Kitchen remodel]]"` on the next write. It is documented as a feature. **Owner's call:** keep linking every column, or only link columns?
