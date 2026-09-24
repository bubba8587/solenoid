---
title: The canvas marks a cable whose types no longer match
proposed_ring: C
ask: human
date: 2026-09-24
parents:
  - "[[B17]]"
  - "[[D16]]"
---
## Decision

After adoption or a retype leaves a cable joining incompatible types, the canvas marks it (a cable style or a badge), instead of showing it like any other.

## Why

Today nothing shows it, and only number ports catch a wrong-family value at run time. **Owner's call:** flag it (and how, per DESIGN.md), or rely on [[D16]] retypeReconciles pruning such cables?

## What ratifying means

- **Flag it:** a cable whose ends no longer fit gets a visible mark (for example a dashed or error-tinted stroke) until you fix or remove it. The exact look is a DESIGN.md call.
- **Rely on pruning:** no new mark. Such cables should be rare because a retype prunes cables that no longer fit ([[D16]] retypeReconciles), so the remaining cases are gaps in pruning to fix one by one.
- **Lean:** rely on pruning and fix the gaps. A mark for a state that shouldn't exist adds chrome.
