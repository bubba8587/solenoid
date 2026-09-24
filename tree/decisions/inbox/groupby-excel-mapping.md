---
title: Excel's GROUPBY maps to the frame GROUPBY card, not Group Lists
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C51]]"
  - "[[D73]]"
---
## Decision

In `nodeExcel.ts`, Excel's GROUPBY is recorded on the frame GROUPBY card. Group Lists, its one-dimensional sibling, points at it in its description rather than claiming the name.

## Why

Today only Group Lists claims GROUPBY, so the Function Reference sends GROUPBY to Group Lists. Group Lists matches the formula's list form (keys, values, a function); the frame card wears the name. The Add-menu alias row is already gone (af2fc377). **Owner's call:** which card owns the Excel name?

## What ratifying means

- **Ratify:** the Function Reference entry for GROUPBY opens the frame GROUPBY card. Group Lists keeps a description line pointing there.
- **Reject:** Group Lists keeps the name, and the frame card stays unnamed in the reference.
- **Lean:** ratify. It matches your 09-24 wording that prose calls the frame card GROUPBY.
