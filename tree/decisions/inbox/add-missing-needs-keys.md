---
title: "Add-missing writes blank keys only for the keys you list"
proposed_ring: D
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[B1]]"]
---
## Decision

With `addMissing` on, Write Properties adds a blank `key:` only for keys named in its key list; with no list it adds none.

## Why

Today with no key list, every note that lacks any written key gets a blank one. **Owner's call:** is filling every note with blank keys intended?

## What ratifying means

- **Ratify:** with Add missing on and no key list, a write adds no blank keys. To add blank keys you name them in the list.
- **Reject:** an empty list keeps adding a blank key for every written column to every note that lacks it, which can touch every note in the folder in one write.
- **Lean:** ratify. A vault-wide blank-key write is the kind of change that is hard to undo in Obsidian.
