---
title: "The test runner always sees newly added or deleted example files"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B7]]"
---
## Decision

Turn off the test runner's file cache, so a newly added or deleted file, such as a new example graph, is picked up at once. Today a new example can be invisible to local test runs until someone deletes the cache folder by hand. After, local runs always see the current files.

## Why

A stale cache once hid a new example graph, so tests passed locally and failed in the automatic check.

## What ratifying means

- **Lean:** Ratify.
- **Ratify:** Local test runs are a little slower and never stale.
- **Reject:** The cache stays, and deleting it by hand stays a habit.
