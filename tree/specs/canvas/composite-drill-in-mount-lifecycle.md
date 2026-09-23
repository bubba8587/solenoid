---
aliases: ["Composite drill-in mount lifecycle"]
tags: [spec, canvas]
---
<!-- [[C77]] compositeIsSubgraph -->

# Spec: Composite drill-in mount lifecycle

Serves [[C77]] compositeIsSubgraph. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

A composite node holds a real subgraph in its own `internalEditor`. Opening it ("drilling in") shows that subgraph on a full canvas, `FlowCompositeOverlay`, which renders the same `FlowSurface` as the main canvas. This spec covers what lives for the life of the composite, what lives only while it is open, and how chrome follows whichever canvas is showing.

## What lasts and what doesn't

Two lifetimes, on purpose:

- **The drill stack lasts as long as the composite.** `DrillStack` holds the level's flow view, its topology pipe and its snapshot history. It is created once per composite instance by `getDrillStack` and cached on the node as `__flowDrill`. The pipe attaches to the long-lived `internalEditor`, and rete has no way to remove a pipe, so building a fresh stack on every open would pile up dead pipes.
- **The React surface lasts only while open.** Closing unmounts the whole React tree, so every card component's effects stop with it. A timer inside a card in a closed composite (a Connection node's auto-refresh, for example) cannot keep running, because there are no per-view React roots left behind.

## The topology pipe

The cached pipe watches the internal editor for `nodecreated`, `noderemoved`, `connectioncreated` and `connectionremoved` (a `noderemoved` also runs the per-node forget, below under Deleting inside a level). Each burst of events queues one sync on a microtask. A sync:

1. waits while the stack is rebuilding (`s.rebuilding`, the drill-in's own version of `isGraphRebuilding`), checking again on a 0ms timer;
2. syncs the RF node set (`syncTopology`);
3. recomputes, targeting the root of the breadcrumb (`stack[0]`, the ancestor that lives in the main editor);
4. schedules an autosave and an undo record.

## Opening a level

On mount, `FlowDrillInner`:

1. raises the rebuild gate (`s.rebuilding = true`) and hydrates the composite's internal graph;
2. gives each internal node its saved position from `comp.internalPositions`, or, for a node with none, a slot on a fallback grid four columns wide (260 × 160 apart);
3. lowers the gate and syncs the topology once;
4. registers the level as the active graph (`setActiveGraph({ editor, view })`);
5. swaps the chrome's command slots to this level: selection, Tidy and Cleanup, the touch delete button, and docked-FC repositioning ([[react-flow-surface-contract]]);
6. records a first undo snapshot if the history is empty.

On unmount it restores the four slots, exits isolate mode, clears the active graph (`setActiveGraph(null)`), copies node positions back into `comp.internalPositions`, and re-applies the main canvas's semantic zoom.

**Framing waits for measurement.** Framing on mount would frame a set of nodes that have no size yet, and the camera would land off the graph. The drill-in sets the `fitViewOnInit` hook instead. `FlowSurface` then waits for React Flow's `useNodesInitialized()`, frames the bounds of all nodes once, and floors the zoom to a snap step.

## Leaving a level

Leaving a level (the breadcrumb, or Escape, which goes up one level) runs `leaveLevel`, then `compositeEditorStore.backTo(i)`, then `settleAfterLeave`.

- `leaveLevel` flushes any pending undo record and saves positions. It then reconciles the composite's ports against the parent editor: any port whose marker node was deleted inside is removed, together with the parent's cables on it. If any cables went, a warning notice says how many cables and ports were removed. Finally it syncs port labels.
- `settleAfterLeave` re-renders the composite's card on the main canvas (when the parent is the main editor), recomputes from `stack[0]`, and schedules an autosave.

## Undo inside a composite

Snapshot undo is per composite and lives on the drill stack, so it survives closing and reopening by design.

- A record is `comp.snapshotInternal()` as JSON, taken after copying current positions into the composite. Records are merged within 400ms, skipped if identical to the current one, and capped at 50.
- Undo and redo call `comp.restoreInternal()`, which tears down the whole internal graph before re-hydrating, under the rebuild gate. One restore runs at a time, and the restore's own compute pass records nothing new, since its snapshot matches.
- The pipe only sees topology. Edits made inside components (an op change, say) are caught through `compositePassStore`: whenever `comp.runSeq` has advanced, every internal card re-renders and a record is scheduled. `runSeq` counts this composite's `data()` runs, and nothing inside the subgraph can change without one, so it is the exact signal that the composite's internals changed. `compositePassStore` itself ticks after every `processGraph`, including passes that never touched this composite, so it is not a signal on its own.
- Moves record too (the `afterMove` and `afterProgrammaticMove` hooks).

## Deleting inside a level

The drill-in deletes through the main canvas's verb, `deleteSelection`, with its own `DeleteScope` ([[react-flow-surface-contract]]): the same ghost splicing, Conduit ghosts and FC unsplice, gated by `s.rebuilding`. It never deletes a boundary marker, since markers are the composite's ports, and it never touches the main canvas's drawn cables or standoffs; copy skips markers the same way.

The topology pipe also carries the per-node forget ([[C40]] storesRegisterForget): every `noderemoved` forgets the node's stores, even under the rebuild gate, since an undo restore re-hydrates under fresh ids and a removed id never returns. Outside the gate it also rebuilds group membership, re-syncs collapse, and restores a deleted group's pushes.

## Document switches

`rebuildGraph` (`persistence.ts`) calls `compositeEditorStore.close()` in its bulk reset, alongside `reportStore.close()` and `presentationStore.stop()`. A drill-in left open across a document switch would render a composite node that belongs to a dead graph.

## Shared behavior comes from shared modules

Anything the drill-in shares with the main canvas comes from the same module, never a copy: `installFlowPinch`, `installTouchCardPan`, `installWheelZoom`, `FlowCableEdge`, `SolNodeAdapter`, `minimapFillForNode`, and the Tidy factory `makeArrangeFn` with `makeCleanupFn` ([[pointer-gestures]]). The drill-in's Tidy uses the same factory, because a bare ELK pass would move group bodies without their members, and it refits the view afterwards, except for a Tidy scoped to one group (the group header's Tidy, which lays out just its members).

## The breadcrumb

`compositeEditorStore.ts` keeps the drill-in stack as a list of composite node instances, not ids: a nested composite is not in the main editor, so an id alone could not find it. The stack gives two things:

1. Recompute always targets `stack[0]`, the ancestor in the main editor, so an edit any number of levels deep ripples outward correctly.
2. A level's parent editor is the internal editor of `stack[i-1]` (the main editor at level 0). That is the editor a level reconciles its ports against when it closes.

## Drill-in chrome

- The drill-in's backdrop fills the region the main canvas occupies, above it and below the app chrome (header, status bar, the menu and Navigator), and is opaque, so drilling in swaps only the canvas surface while the app frame stays put.
- The one drill-in-specific piece of chrome is the floating strip at the top left, below the app header and clear of the top-right menu: the breadcrumb (each crumb a quiet text button, the current one emphasized and inert) and the port-promotion buttons, on a sunken fill with an accent-tinted border as a state cue. Undo, delete, add, zoom and the rest are the real toolbar and keyboard pointed at the active graph.
- The run-mode panel sits directly under the strip, because the top-right corner belongs to the Zoom pill and the Problems and Alerts HUDs. It mirrors the outer card's controls, and its head bar always shows the current run mode while the body folds.
- While drilled in (`html.sol-drilled-in`) the main minimap hides and the drill-in's own shows; the Navigator stays folded, because its list still reads and acts on the main graph; and the covered main canvas stops painting (`visibility: hidden`, [[C75]] gpuTextureBudget).
- On mobile the strip clears both top rows and the notch, stops before the right-anchored Fit and Lock pill, and stacks the crumbs above the port buttons; the run panel moves to the bottom left just above the bottom pill and starts collapsed; and the drill-in minimap is off.

## The canvas-substitution seam

`activeGraph.ts` is the extension point for any surface that takes over the canvas: the drill-in today, possibly a focus or scratch surface later.

- On mount the surface calls `setActiveGraph({ editor, view })`; on unmount, `setActiveGraph(null)`. Subscribers (`subscribeActiveGraph`) are notified on each change, and `isSubgraphActive()` reports whether an override is set.
- Chrome reads `getActiveEditor` / `getActiveView`, and per-node code reads `getOwningEditor` / `getOwningView`, never `getEditor`. Keyboard shortcuts, copy and paste, context menus, the command palette, Tidy, selection, zoom, fit, lock and the minimap then follow the surface with no further wiring.
- `getEditor()` / `getView()` stay bound to the main graph, because persistence reads them; pointing them at the override would autosave the substituted surface over the document ([[C33]] saveBindsMain).
- `getOwningEditor(id)` checks the override first, then the main editor, then any graph registered with `registerOwnedGraph`. Owned graphs are locked auxiliary canvases (the landing scene cards) whose nodes need to resolve at render time but which are never the action target. Several can be live at once, so they are a set. `getOwningView` mirrors this.

Nested levels need no stack in `activeGraph.ts`, because drilling replaces rather than piles up: drilling deeper unmounts the current level (its cleanup clears the override) and mounts the deeper one (which sets it again). The breadcrumb lives in `compositeEditorStore`; `_override` holds only the current surface. Grow `_override` into a push and pop stack only if a feature ever needs two live action targets at once.
