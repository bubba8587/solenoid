---
title: "The Schedule card's engine is published as a public Rust package"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C69]]"
---
## Decision

Publish the scheduling engine behind the Schedule card as an open-source (MIT) package on crates.io, Rust's public package registry, under the name solenoid-schedule, starting at version 0.1.0. Today it lives only inside Solenoid; after, anyone can add it to a Rust project.

## Why

It is ready and the name is free. Publishing is public, and the version is yours to set.

## What ratifying means

- **Lean:** Wait until someone else wants to use it, as the rule says; nothing is lost by waiting.
- **Ratify:** You run the publish command (an agent can prepare it but can't hold your account token).
- **Reject:** It stays in Solenoid's code only.
