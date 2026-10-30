---
title: "The empty-slot decision stops linking to two smaller decisions under it"
proposed_ring: C
ask: human
date: 2026-10-29
parents:
  - "[[A5]]"
---
## Decision

The settled decision on empty formula slots (C80) still links down to two decisions that sit under it, which breaks the rule that a decision links only upward. It says a blank value "follows its input's role ([[D86]] blankRoles), so data stays missing ([[D36]] nullSkippedNotZero)". The sentence would stay and the two links would go.

## Why

A decision that leans on ones made under it can't be read or weighed on its own, and a change below would quietly change its meaning.

## What ratifying means

- **Lean:** Ratify. Nothing about the app changes; the sentence reads the same without the links.
- **Ratify:** The two links go.
- **Reject:** C80 keeps linking down, the only leaf in the tree that does.
