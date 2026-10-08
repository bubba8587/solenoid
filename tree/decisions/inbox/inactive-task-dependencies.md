---
title: A task that waits on an inactive task skips that dependency
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C70]]"
---
## Decision

When a task depends on a task whose Active is false, the dependency is dropped (the waiting task schedules as if it weren't there), instead of erroring.

## Why

Today deactivating a task others wait on errors "which is not a task", and a test pins that. **Owner's call:** drop the link silently, drop it with a notice, or keep the error?

## What ratifying means

- **Drop silently:** switching a task's Active off lets everything that waited on it schedule as if the link weren't there.
- **Drop with a notice:** same schedule, plus a per-row note naming the dropped link.
- **Keep the error:** today's behavior. The whole schedule errors until you remove the link by hand.
- **Lean:** drop with a notice. Deactivating a task is how you try what-ifs, and an error blocks that.
