---
title: "Expanding a group never leaves cards overlapping, even with auto-arrange on expand turned off"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C112]]"
---
## Decision

With the setting "Auto-arrange groups on expand" off, expanding a group still moves any card it covers just clear, without the bigger push. Today, with the setting off, an expanded group can sit on top of its neighbors. After, a covered neighbor moves the smallest amount needed.

## Why

The setting turns off both the push and the overlap cleanup, so it breaks the no-overlap rule.

## What ratifying means

- **Lean:** Ratify. Your no-overlap rule has no exemptions, and the cleanup moves far less than the push does.
- **Ratify:** With the setting off, nothing is pushed, but no card is left covered.
- **Reject:** The setting means leave everything where it is, and the no-overlap rule gets a written exception.
