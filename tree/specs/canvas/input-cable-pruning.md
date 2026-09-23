---
aliases: ["Input-cable pruning"]
tags: [spec, canvas]
---
<!-- [[D10]] onePrunePath -->

# Spec: Input-cable pruning

Serves [[D10]] onePrunePath. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

Many nodes change their own sockets: a mode or op switch hides some inputs, a variadic row is deleted, a formula variable or a side socket disappears. Whenever input sockets are about to go away, the cables wired into them are removed first, through one helper. This spec says what that helper does and when code may bypass it.

## The helper

`dropInputCables(nodeId, gone)` in `components/cablePrune.ts` removes every cable wired into the given input sockets of one node.

- `gone` is either the set of departing socket keys, or a predicate over the input key. The predicate form covers the complement case, "every input the next mode does not show".
- It works on the editor that owns the node (`getOwningEditor(nodeId)`), not the active one: a `data()`-time reconciler (Text, Computed Column, Report) can run for a main-canvas node while a drill-in is open, or for a drill-in node. A node inside a closed composite is not reachable this way: its prune finds nothing and its cables outlive the socket (open gap).
- It filters the matching cables into their own list first (rete's `getConnections()` already returns a copy), then removes them one at a time, awaiting each `removeConnection`.
- It is async. Callers await it before they change the sockets.

Undo is snapshot-based and debounced (`flowHistory.schedule`, 400 ms), so the pruned cables normally land in the same undo entry as the edit that removed the sockets.

`dropOutputCables(nodeId, gone)` is the same helper for the output side, for an op switch that removes an output socket. It matches cables by `sourceOutput` instead of `targetInput`.

## The ordering rule

Prune **before** the socket is hidden or removed:

1. Work out which input keys are going away.
2. `await dropInputCables(node.id, keys)`.
3. Then hide the sockets or call `removeInput`, and re-render.

A cable that references a removed socket is unsafe, and a hidden socket with a live cable is an invisible wire.

## Who must use it

The rule binds node classes and pack code as much as components. `tests/graph/sourceInvariants.test.ts` scans every file under `src/graph/components`, `src/graph/nodes` and `src/graph/packs`, and fails on any direct `.removeConnection(` call outside its sanctioned list. A second test fails when a sanctioned file no longer exists or no longer calls `removeConnection`, so the list cannot go stale.

The sanctioned direct callers, each with a genuinely different shape:

| File | Why it calls `removeConnection` directly |
|---|---|
| `components/cablePrune.ts` | The helper itself. |
| `nodes/composite.ts` | `restoreInternal` tears down the whole internal graph before rebuilding it on an undo restore. That is a full clear, not a prune by input key. |
| `components/ConnectionDialog.tsx` | Deletes one user-selected cable (and, on an edit, the cable it replaces). |
| `components/InterpolateNode.tsx` | The List / Grid variant switch swaps the entire socket set, so it prunes inputs and outputs together. |
| `components/ListInputNode.tsx` | A type-compatibility filter: it keeps the cables the new element type still accepts (`canConnect`) and drops the rest. |
| `components/ReportOverlay.tsx` | Targets the main editor explicitly (`getEditor`), because a Report edits main-graph references even while a drill-in is active. |
| `components/expressionEdit.ts` | The Equation prune covers both directions, because a variable owns an output socket too. Expression and LAMBDA already use the helper. |

A new direct caller needs its reason added to that list in the test.
