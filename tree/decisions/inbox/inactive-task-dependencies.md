---
title: "A Schedule task that waits on a switched-off task schedules as if that link weren't there, with a note"
proposed_ring: D
ask: human
date: 2026-09-24
parents:
  - "[[C70]]"
---
## Decision

When a task depends on a task whose Active is off, the link is dropped: the waiting task schedules as if it weren't there, and its row gets a note naming the dropped link. Today, switching off a task that others wait on makes the whole Schedule show an error ("which is not a task").

## Why

Switching a task off is how you try what-ifs, and the error blocks that.

## What ratifying means

- **Lean:** Ratify.
- **Ratify:** Switching a task's Active off lets everything after it reschedule, with a note on each affected row.
- **Reject:** The error stays until you remove the link by hand. The other option drops the link silently, with no note.
