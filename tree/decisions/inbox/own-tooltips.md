---
title: "The app draws its own tooltips"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B14]]"
---
## Decision

Replace the 469 native `title` tooltips with an app tooltip, so size and delay are the app's on every webview.

## Why

On Linux, WebKitGTK hands `title` to GTK, so tooltips are huge and instant (author 2026-09-21, not urgent).

## What ratifying means

- **Ratify:** one tooltip component, styled by DESIGN.md.
- **Reject:** native titles stay.
- **Lean:** ratify, not urgent.
