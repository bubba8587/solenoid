---
title: "The table editor's Insert and Delete menus get the rounded pill style of the toggles beside them"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B14]]"
---
## Decision

In a table popup's editing footer, the Insert and Delete menus are drawn as rounded pills, matching the toggles next to them. Cancel and Save keep their dialog-button style. Today the two menus have square corners beside rounded toggles.

## Why

The menus are controls like the toggles, so their older square style stands out. Cancel and Save are dialog actions, so they may rightly differ.

## What ratifying means

- **Lean:** Ratify.
- **Ratify:** The two menus become pills; Cancel and Save stay as they are.
- **Reject:** The footer keeps its current look.
