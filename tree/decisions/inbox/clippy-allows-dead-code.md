---
title: "CI's clippy keeps denying dead code"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C130]]"
---
## Decision

Keep `-D warnings` with dead code denied in `engine-test.yml`.

## Why

A helper that lands one commit before its caller turns CI red; the alternative is `-A dead_code` on the two clippy lines.

## What ratifying means

- **Ratify:** helpers land with their callers.
- **Reject:** dead code is allowed and caught only by review.
- **Lean:** ratify: dead code is what the no-redundant-code rule targets.
