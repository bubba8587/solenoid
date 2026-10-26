---
title: "The canvas marks a cable whose two ends no longer fit each other"
proposed_ring: C
ask: human
date: 2026-09-24
parents:
  - "[[B17]]"
  - "[[B11]]"
---
## Decision

When a cable ends up joining sockets whose types don't fit (after you accept a dashed ghost cable, or a card's socket changes type), the canvas marks it, for example with a dashed or error-tinted line. Today such a cable looks like any other, and only a number input catches the wrong value when it runs.

## Why

A mismatched cable gives no sign today. The alternative is to rely on a type change removing cables that no longer fit, and fix the cases it misses.

## What ratifying means

- **Lean:** Reject: rely on the removal and fix its gaps one by one. A mark for a state that shouldn't exist adds clutter.
- **Ratify:** A mismatched cable gets a visible mark until you fix or remove it; the exact look follows the design rules.
- **Reject:** No new mark. Such cables stay rare, and each gap in the removal is fixed as found.
