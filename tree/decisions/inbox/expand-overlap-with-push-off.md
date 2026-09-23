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
