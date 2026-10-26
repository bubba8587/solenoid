---
title: "Typing 1,,3 into List Input gives a list of three with a blank in the middle"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B17]]"
---
## Decision

A blank between commas in List Input is kept as a blank item. Today, typing `1,,3` gives a list of two numbers. After, a list of three with a blank in the middle, the same way `1,x,3` keeps three items and a wired blank stays in place.

## Why

A typed list and a wired list disagree about blanks.

## What ratifying means

- **Lean:** Ratify. A value should keep its shape.
- **Ratify:** A typed gap is kept as a blank.
- **Reject:** Empty fields keep dropping out.
