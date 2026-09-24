---
title: Escape in a Note or Report body keeps the draft and leaves the field
proposed_ring: E
ask: human
date: 2026-09-24
parents:
  - "[[C95]]"
---
## Decision

In the Note and Report body textareas, Escape commits the draft and leaves the field, instead of reverting it as a one-line field does. This is an exception under C95 commitOnEnter, removed if the bodies ever get their own undo.

## Why

C95 says Escape reverts a draft. On a one-line field that loses a few characters; on a long body it can throw away minutes of writing with one key. Today Escape in these textareas neither reverts nor commits. **Owner's call:** Escape commits, Escape reverts (as C95 says), or Escape does nothing?

## What ratifying means

- **Escape commits:** in a Note or Report body, Escape saves what you typed and leaves the field. [[C95]] gains an exception for long text.
- **Escape reverts:** consistent with every other field, but one key can throw away a long edit with no undo inside the body.
- **Escape does nothing:** today's behavior, now written down; you leave by clicking away, which saves.
- **Lean:** Escape commits. Losing minutes of writing to one key is the worse failure.
