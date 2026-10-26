---
title: "Aligning cards never leaves them on top of each other"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C112]]"
---
## Decision

Align ends with the same small cleanup that Tidy, nudge and distribute already end with, so no two cards are left overlapping. Today, aligning two side-by-side cards to the same left edge puts one on top of the other. After, the second is moved just clear, slightly off the edge.

## Why

A spec line written by an agent lets Align overlap on purpose, while your older note said align, distribute and Tidy never leave overlaps.

## What ratifying means

- **Lean:** Ratify. Your standing rule is no overlaps ever, with no exemption for intentional ones.
- **Ratify:** After Align, cards that would land on each other are nudged apart by the smallest amount, so a few may sit slightly off the aligned edge.
- **Reject:** Align stays exact and can stack cards, and the no-overlap rule gets a written exception for it.
