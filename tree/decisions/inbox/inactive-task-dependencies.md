---
title: "A task that waits on an inactive task skips that dependency"
proposed_ring: D
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[C70]]"]
---
## Decision

When a task depends on a task whose Active is false, the dependency is dropped (the waiting task schedules as if it weren't there), instead of erroring.

## Why

Today deactivating a task others wait on errors "which is not a task", and a test pins that. **Owner's call:** drop the link silently, drop it with a notice, or keep the error?
