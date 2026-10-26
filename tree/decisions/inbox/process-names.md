---
title: "The app's behind-the-scenes processes get proper names for docs and conversation"
proposed_ring: C
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B14]]"
---
## Decision

Give proper names to the steps the app runs behind the scenes, for use in specs and in chat. Candidates: the Pass (one recalculation of the graph), the Dimension Pass, the Type Settle, the Rebuild and the Error Guard, plus names floated on 10-25 such as the Reader and the Formatter. Today these are long descriptive phrases, and "plan" alone has five meanings. After, each has one name in the glossary.

## Why

Proper names, as LayoutFx and VaultBridge already are, keep specs and chat unambiguous.

## What ratifying means

- **Lean:** Pick them one at a time; the Pass and the Type Settle are already in use.
- **Ratify:** The names you pick go into the glossary and the specs.
- **Reject:** The descriptive phrases stay.
