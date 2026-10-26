---
title: "Write Properties turns text into a note link only in a column that holds links"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[B1]]"
  - "[[B17]]"
---
## Decision

Write Properties writes a text cell as a note link only when its column is a link column (typed as links, or read from a property that held links). Today a project column holding "Kitchen remodel" turns into a link to the Kitchen remodel note on the next write, if that note exists. After, it stays plain text.

## Why

Any text that matches a note's name becomes a link today, and you can't tell which values will match.

## What ratifying means

- **Lean:** Ratify. Turning plain text into a link changes the note in a way you didn't ask for.
- **Ratify:** Plain text stays plain; only link columns write links.
- **Reject:** Any value matching a note name keeps becoming a link on the next write.
