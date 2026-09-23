---
aliases: ["Addressable model"]
tags: [spec, documents]
---
<!-- [[C19]] namingModel -->

# Spec: Addressable model

Serves [[C19]] namingModel. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

Every node has a **name**: a stable identifier the user can edit, used wherever one part of a document refers to a node. This spec says what a name is and what it is not. The text form's grammar and round-trip rules are in [[save-format]].

## Names and ids

- A node's name is separate from its rete `id`. The id is random and is minted fresh on every load (`rebuildGraph`'s `idMap` maps saved ids to live ones), so nothing that must survive a reload may assume an id is stable.
- A name must be an identifier (`^[A-Za-z_][A-Za-z0-9_]*$`) and is unique within a document.
- A new node gets a default name from a counter scoped to its type: the class name without its trailing `Node`, then `_` and the next free number (`Filter_1`, `Filter_2`). The user can rename it, and the rename is validated for uniqueness.

## The label is not the name

`label` is a separate per-instance display field. It persists, and Note, Group, Image, SVG Picker and Presentation cards edit it directly, but it is not the addressable name, and nothing resolves a reference through it.

## The text form addresses by name

The text form (one node per line) is a second view of the same document, beside the canvas and the JSON save. Every reference in it, on node lines and in the sidecar alike, is by name, never by id. Its grammar, line order, canonicalization, sidecar and round trip are [[save-format]] § The text form.
