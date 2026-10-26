---
title: "The app draws its own tooltips instead of the system's"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B14]]"
---
## Decision

Replace the app's 469 system tooltips with one tooltip of its own, so size and delay are the same everywhere. Today, on the Linux desktop app, tooltips are huge and appear instantly. After, they look and time the same as in a browser.

## Why

On Linux, the desktop app's web engine hands tooltips to the system, which draws them large and with no delay. You flagged it as not urgent.

## What ratifying means

- **Lean:** Ratify, not urgent.
- **Ratify:** One tooltip, styled by the design rules, everywhere.
- **Reject:** System tooltips stay.
