---
title: "solenoid-schedule is published on crates.io"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C69]]"
---
## Decision

Publish `crates/solenoid-schedule` (MIT) on crates.io under that name, starting at 0.1.0.

## Why

The crate is ready (`cargo package` lists cleanly, README contract, one dependency) and the name is free. Publishing is outward-facing and the version is the author's.

## What ratifying means

- **Ratify:** the author runs `cargo publish` from the crate (an agent can prepare it but not hold the token).
- **Reject:** it stays in-repo only.
- **Lean:** ratify when a second user appears, per C69's reopen condition; nothing is lost by waiting.
