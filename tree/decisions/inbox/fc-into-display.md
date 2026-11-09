---
title: "The Format Controller card goes, and the Display card gets its format control"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-29
parents:
  - "[[C25]]"
---
## Decision

Checked on 2026-10-29. The Value Input card already sets a value's display format and unit where the value starts. What's left is the other end and the old card: the Display card gets the same format control, and the Format Controller (the separate card you dock onto another card to format its box) goes away. Today, to format a computed result, you dock a Format Controller onto the card that makes it. After, you set the format on a Display, or on the Value Input upstream, and it carries downstream.

## Why

You proposed this and held it until you'd lived with formats set at the source. Value Input now does that, so the remaining question is whether the Format Controller still earns its place.

## What ratifying means

- **Lean:** Your call; you held it for a reason.
- **Ratify:** Display gets a format control, the Format Controller and its docking go, and example graphs using it are reworked.
- **Reject:** The Format Controller stays beside Value Input's own format control.
