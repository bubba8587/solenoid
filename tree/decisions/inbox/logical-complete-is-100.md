---
title: A logical TRUE in a Schedule's Complete column reads as 100%
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C70]]"
---
## Decision

In the Schedule, a Complete column holding logicals (a TaskNotes-style done checkbox) reads TRUE as 100% and FALSE as 0%.

## Why

Today any non-number reads as 0, so a done task shows 0%. **Owner's call:** read logicals, or keep Complete numeric only?

## What ratifying means

- **Ratify:** a TaskNotes done checkbox wired as Complete shows done tasks at 100% on the Gantt and in progress roll-ups.
- **Reject:** Complete takes numbers only, and a checkbox column has to go through a formula (`IF(done, 100, 0)`) first.
- **Lean:** ratify. TaskNotes is the flagship integration and its done field is a checkbox.
