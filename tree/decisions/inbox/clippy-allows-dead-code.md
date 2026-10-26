---
title: "The automatic code check keeps failing a change that adds unused code"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C130]]"
---
## Decision

The automatic check that runs on every push keeps treating unused code as an error. Today, if a helper lands in one commit and the code that uses it lands in the next, the first commit's check turns red. That stays.

## Why

The red check is a nuisance when work arrives in pieces. The alternative is to let unused code pass the check.

## What ratifying means

- **Lean:** Ratify. Unused code is exactly what the no-redundant-code rule is meant to catch.
- **Ratify:** A helper always lands together with the code that uses it.
- **Reject:** Unused code passes the check and is caught only in review.
