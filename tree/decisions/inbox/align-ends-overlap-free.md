---
title: "Align ends with the no-overlap pass"
proposed_ring: D
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[C112]]"]
---
## Decision

Align, like Tidy, nudge and distribute, ends with `separateAll`, so aligning cards never leaves them overlapping.

## Why

An agent-written spec line allows Align to overlap on purpose; the owner's older note said align, distribute and Tidy own overlap. **Owner's call:** does Align end overlap-free?
