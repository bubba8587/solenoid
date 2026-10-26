---
title: "A dashed ghost cable stays dashed after a reload, and only a splice ghost passes its value"
proposed_ring: C
ask: human
date: 2026-09-24
parents:
  - "[[B12]]"
  - "[[B17]]"
  - "[[B3]]"
---
## Decision

A ghost cable is the dashed cable left when you delete a card mid-chain (a splice joining its neighbors) or when a socket changes type but stays wired. The dashed look is saved, a splice ghost keeps passing its value, and a type-change ghost passes nothing until you accept it. Today a reload turns every ghost solid, so a type-change ghost silently becomes a real, wrongly typed cable.

## Why

The dashed state is lost on save, and a type-change ghost feeds a value that doesn't fit, which shows up as an error downstream.

## What ratifying means

- **Lean:** Ratify. Saving the dashed look is needed under any choice; only the feeding is a real choice.
- **Ratify:** Ghosts stay dashed after a reload; deleting a card mid-chain keeps the numbers flowing; a type-change ghost feeds nothing until accepted.
- **Reject:** Today's behavior stays: every ghost feeds and turns solid on reload. Other choices: save the look, and have no ghost feed, or every ghost feed.
