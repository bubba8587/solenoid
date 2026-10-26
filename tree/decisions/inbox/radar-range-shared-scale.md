---
title: "Setting a range on a radar chart with several series switches it to one shared scale"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C96]]"
---
## Decision

On a radar chart with several series, setting the chart's y min or y max switches Scale to shared, so the range takes effect. Today, with Scale set to per axis, a y max of 100 is ignored on a multi-series radar, though a single-series radar honors it. After, setting it puts every axis on one scale up to 100.

## Why

A setting that silently does nothing is confusing. The alternative is to write it down as an exception, as multi-series color already is.

## What ratifying means

- **Lean:** Ratify.
- **Ratify:** A range you set is always honored.
- **Reject:** The range stays ignored under per-axis scale, written down as an exception.
