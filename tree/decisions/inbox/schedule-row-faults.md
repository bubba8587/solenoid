---
title: "A Schedule row fault stays on its row"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C70]]"
---
## Decision

Either the Schedule card grows a per-row fault path (a bad Duration or unparseable date stays on its row, as C70 says), or C70's line changes to say one fault fails the run.

## Why

`read_level` in `nodes/sched.rs` fails on every fault, so the whole run is one #VALUE! on every output, against C70's text.

## What ratifying means

- **Ratify:** the card grows the per-row path.
- **Reject:** C70 is amended to the aggregate behavior.
- **Lean:** amend C70: E10's aggregate rule already says a structural failure is one error, and a partial schedule could mislead.
