---
title: "vitest runs without its module cache"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B7]]"
---
## Decision

Turn off vitest's `fsModuleCache`, so a new or deleted file under an `import.meta.glob` is seen without deleting `node_modules/.vitest-cache`.

## Why

A warm cache hid a new seed locally and CI failed; the workaround is a manual delete before every full run.

## What ratifying means

- **Ratify:** local runs are a little slower and never stale.
- **Reject:** the cache stays and the delete stays a habit.
- **Lean:** ratify.
