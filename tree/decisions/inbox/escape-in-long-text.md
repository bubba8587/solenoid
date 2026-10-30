---
title: Pressing Escape in a Note or Report body keeps what you typed
proposed_ring: E
ask: human
date: 2026-09-24
parents:
  - "[[C95]]"
---
## Decision

In the body of a Note or Report, Escape saves what you typed and leaves the field, instead of throwing the edit away as Escape does in a one-line field. Today Escape there does nothing. After, it saves and leaves. This stays an exception until the bodies get their own undo.

## Why

The rule says Escape throws away a draft. In a one-line field that loses a few characters; in a long body one key could throw away minutes of writing.

## What ratifying means

- **Lean:** Ratify. Losing minutes of writing to one key is the worse failure.
- **Ratify:** Escape in a Note or Report body saves and leaves the field.
- **Reject:** Escape throws the edit away, as in every other field, with no undo inside the body; or it keeps doing nothing and you leave by clicking away, which saves.
