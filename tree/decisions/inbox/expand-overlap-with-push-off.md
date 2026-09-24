---
title: "Expanding a group ends overlap-free even with auto-arrange on expand turned off"
proposed_ring: D
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[C112]]"]
---
## Decision

With "Auto-arrange groups on expand" off, expanding a group still runs the final no-overlap pass (`separateAll`), without the push.

## Why

Today with the setting off, expand runs no push and no pass, so it can cover neighbors; [[C112]] noOverlapsEver records this as open. **Owner's call:** run the pass anyway, or let the setting mean "leave everything where it is"?

## What ratifying means

- **Ratify:** with the setting off, expanding a group doesn't push anything, but any card left overlapping is moved just clear of it.
- **Reject:** the setting means leave everything where it is, and [[C112]] keeps this as a named exception.
- **Lean:** ratify. Your no-overlaps rule has no exemptions, and the pass moves far less than the push does.
