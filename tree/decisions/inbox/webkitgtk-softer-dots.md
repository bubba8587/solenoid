---
title: "The canvas dots soften on WebKitGTK"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B14]]"
---
## Decision

On `html[data-webview="webkitgtk"]`, the canvas dots use a softer color or a slightly larger dot, as the zoom fixes are keyed.

## Why

WebKitGTK antialiases a sub-2px circle harder than Skia, so the Linux desktop's dots read harsher (author 2026-09-21).

## What ratifying means

- **Ratify:** a per-webview `--canvas-dot`.
- **Reject:** one look everywhere.
- **Lean:** ratify.
