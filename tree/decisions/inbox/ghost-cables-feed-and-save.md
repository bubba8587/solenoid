---
title: "A ghost cable feeds nothing until adopted, and stays a ghost across a save"
proposed_ring: C
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[B12]]", "[[B17]]", "[[C43]]"]
---
## Decision

A dashed ghost cable (a splice left by a delete, or a retype that stayed wired) feeds no value until the user adopts it, and the ghost mark is saved with the document, so a reload shows it dashed again instead of solid.

## Why

Today a ghost is an ordinary connection to the engine: a splice ghost already carries its value, and a retype ghost feeds a value that doesn't fit, which lands as an error downstream. The mark is view state, so a reload turns every ghost solid, and a pending retype ghost silently becomes a real, ill-typed cable ([[B12]] losslessSaves). The alternative is to keep today's behavior and write it down: a splice ghost carrying its value is what a user deleting a relay expects. **Owner's call:** should a ghost feed its value before adoption, and should the dashed state survive a save?
