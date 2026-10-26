---
title: "A stale line in the agent instructions file is reworded"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[D99]]"
---
## Decision

One line in CLAUDE.md, the instructions file agents read at the start of every session, tells them when to read the list of places Solenoid's answers differ from Formula.js (the open-source library Solenoid's function answers were first matched against). It names a piece of code that has since been removed. After, it reads "before changing a function whose answer differs from Formula.js's".

## Why

The line points agents at something that no longer exists. CLAUDE.md is your file, so agents don't edit it without your word.

## What ratifying means

- **Lean:** Ratify.
- **Ratify:** You edit the line, or let an agent do it.
- **Reject:** The line stays out of date.
