---
aliases: ["Compute pass and the input boundary"]
tags: [spec, computation]
---
<!-- [[C23]] calcModes, [[D46]] freezeVolatilePerCalc, [[D35]] errorInErrorOut, [[D33]] unwiredNotBlank, [[D42]] perInputUnitBlind, [[D79]] effectsEdgeTriggered, [[C10]] socketLattice, [[C15]] matricesInFormulas, [[C17]] shareImpl -->

# Spec: Compute pass and the input boundary

Serves [[C23]] calcModes, [[D46]] freezeVolatilePerCalc, [[D35]] errorInErrorOut, [[D33]] unwiredNotBlank, [[D42]] perInputUnitBlind, [[D79]] effectsEdgeTriggered, [[C10]] socketLattice and . It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

This file owns what happens from "something changed" to "every card shows its new value": how the engine is driven, which nodes a pass recomputes, the calc mode, volatile nodes, rebuild scopes, and what a value goes through between leaving one node's output and reaching the next node's `data()`. Which cables may connect at all is [[socket-lattice]] ([[C10]] socketLattice); this file starts once a cable exists. The error codes and their meaning are [[error-values]]; units on the value are [[unit-flow]]; the null and blank semantics a `data()` applies are [[value-semantics]].

## Terms

- **Pass.** One run that fetches every node's outputs from the engine. A pass is full (every cache entry dropped first), targeted (only a downstream cone dropped) or additive (nothing dropped).
- **Cone.** `downstreamClosure(editor, id)`: the node `id` plus every node reachable from it over outgoing cables.
- **Loop members.** The nodes on a dependency cycle: every node with a self-cable, and every node in a strongly connected component of two or more nodes. Nodes merely downstream of a loop are not members.
- **Rung.** A socket's declared `SocketDataType` (`number`, `list`, `numlist`, `table`, `frame`, `cube`, `anylist` and so on). Coercion works against the rung.
- **Wrapper.** A function installed over a node's `data()` at `nodecreated`. Every node carries two: input coercion (inner) and the error guard (outer).

## The engine

The model is a rete `NodeEditor`; the engine is a rete-engine `DataflowEngine` attached with `editor.use(engine)`. The app uses only `fetch`, `reset` and the public `cache`.

- **Registration.** The engine listens for `nodecreated` and registers a setup per node id; `noderemoved` unregisters it. A node's input and output key sets are read live (`Object.keys(node.inputs)`, `Object.keys(node.outputs)`) at every fetch, so a node that adds or removes sockets needs no re-registration.
- **Pull.** `engine.fetch(id)` returns the node's outputs. If the cache holds an entry for `id`, that entry (a promise) is returned. Otherwise the engine creates a cancellable promise that first fetches the inputs, then calls `node.data(inputs)`, and stores it in the cache under `id` before it resolves. Fetching inputs means: take every connection whose target is `id` and whose `targetInput` is a current input key, fetch each source concurrently, and build `inputs[targetInput]` as an array holding `sourceOutputs[sourceOutput]` for each such cable, in the order `editor.getConnections()` lists them. An input with no cable has no key in `inputs` at all.
- **Output completeness.** After `data()` resolves, the engine checks that the returned object has every current output key and throws a plain `Error` naming the missing ones otherwise. Every path in this file that builds outputs (the error guard, loop seeding) fills every output key.
- **Cache and cancellation.** `engine.cache` maps node id to the promise. Deleting an entry (`cache.delete(id)`) calls that promise's `cancel()`; a cancelled fetch rejects with `Cancelled` at its next step. `engine.reset()` with no id deletes every entry. `engine.reset(id)` deletes `id` and recurses into each cable target with no visited set, so it overflows the stack on a cable cycle; nothing in the app calls it with an id.
- **A node is computed at most once per pass.** Everything that fetches it in the same pass receives the same cached promise, so fan-out costs nothing extra.

## The model pass (`graphCompute.ts`)

`graphCompute.ts` defines the pass with no view. Its pieces:

| Function | Behavior |
|---|---|
| `loopMembers(editor)` | Builds adjacency from every connection (ignoring a target that is not a node in the editor), records self-cables separately, runs an iterative Tarjan SCC (no recursion, so a large graph cannot overflow the stack) and returns the self-loop nodes plus every member of each SCC of size two or more. |
| `downstreamClosure(editor, startId)` | Breadth-first walk over outgoing connections from `startId`, with a visited set, so a cycle terminates. Returns the set including `startId`. |
| `invalidate(editor, engine, changedId?, keepCaches?)` | No `changedId`: `engine.reset()` (skipped under `keepCaches`, for an additive pass), returns `null`. With one: computes the cone and deletes each member's cache entry by hand, returns the cone. |
| `seedLoopErrors(editor, engine, loop, message?)` | For each loop member: builds one `#CIRC!` `SolError` (default message `CIRC_MESSAGE`), sets every output key to it, sets the node's `cachedResult`, `cachedValue` and `cachedList` to it where those properties exist, and stores an already resolved promise with a no-op `cancel` in the cache (`cache.add`, falling back to `cache.patch` when an entry exists). The member's `data()` never runs. |
| `fetchAll(editor, engine, onNode?, { stopOnCancel? })` | Fetches every node in `editor.getNodes()` order, skipping a node removed while an earlier fetch awaited, calls `onNode` with each result, and collects a map of id to outputs. A fetch that rejects with `Cancelled` records `null`, or under `stopOnCancel` ends the pass and answers `null`; any other rejection propagates. |
| `computeAll(editor, engine, changedId?)` | `clearCollectMemo`, `resolveTrigModes`, then `invalidate`, then `seedLoopErrors(loopMembers(...))`, then `fetchAll`. |

Seeding must happen after invalidation and before any fetch: the engine resolves inputs before calling `data()`, so fetching into a cycle would recurse forever. Because a member's cache entry is already resolved, every node downstream of a loop computes normally and shows the propagated `#CIRC!` through the error guard. Seeding only the members, never their descendants, is what makes a full and a targeted pass agree about cycles ([[#The targeted pass equals the full pass]]).

`resolveTrigModes(editor)` runs before every fetch because a trigonometric Math node in automatic angle mode reads its resolved mode during `data()` ([[unit-flow]], the one compute-time unit read).

The headless runner (`scripts/run-graph.ts`) calls `computeAll`. The app's pass (`processGraph`) runs `invalidate` and `fetchAll` with its own bookkeeping, described below. A composite's private engine resets fully and fetches only its output markers, with the same `loopMembers` and `seedLoopErrors`.

### The targeted pass equals the full pass

**MUST:** `downstreamClosure(editor, startId)` is exactly the set of nodes a full pass would recompute differently: the start node and everything that depends on it, through branches and joins, stopping at cycles, no more and no less. Cycles are handled the same way too: the targeted pass seeds `#CIRC!` on exactly the members of each loop, as the full pass does, instead of recursing until the stack overflows.

**MUST:** the pass has one definition, the functions above. `processGraph`, the headless runner and the seed tests all run it, and no second copy of the walk or the loop seeding may exist. The composite's marker-only pull is the one different pass shape.

Recomputing too much only wastes time. Recomputing too little is the dangerous half: a node left outside the set keeps showing its previous answer, with no error, beside fresh values ([[C23]] calcModes).

## The app pass (`processGraph`)

`process.ts` holds the main editor, engine and view (`setEditorRefs`, `getEditor`, `getEngine`, `getView`) and runs the app's pass:

```ts
processGraph(changedNodeId?: string, renderOnly?: Set<string>, opts?: { force?: boolean; topology?: boolean })
```

| Call shape | Mode | Invalidation | Loop set | Nodes re-rendered |
|---|---|---|---|---|
| `processGraph()` | full | `engine.reset()` | recomputed | every node |
| `processGraph(id)` | targeted | cone of `id` deleted by hand | cached (computed if none cached yet) | early cutoff within the cone |
| `processGraph(id, undefined, { topology: true })` | targeted after a cable change | cone of `id` deleted by hand | recomputed | early cutoff within the cone |
| `processGraph(undefined, set)` | additive | none; existing caches stay | recomputed | only the nodes in `set` |
| `processGraph(undefined, undefined, { topology: true })` | full | `engine.reset()` | recomputed | every node |

A targeted pass is correct only for a change whose effect flows solely through cables out of `id`: a value edit on that node, or a cable into it. Any other structural change, a load, or a doubt calls the full form. Callers pass `changedNodeId` or `renderOnly`, never both.

### Entry order

1. **Calc-mode gate.** If the mode is manual, `opts.force` is not set and no rebuild scope is open, the call marks the graph dirty and returns without computing. This is the only gate that drops a pass ([[#Only the calc-mode gate skips a pass]]). A load, seed or paste runs inside a rebuild scope, so an opened document computes even in manual mode.
2. **Single flight.** If a pass is already running, the call sets a rerun flag (and a forced-rerun flag when `opts.force` is set, and an exact-rerun flag when a `beginForceExact` bracket is open) and returns. Passes never nest: a nested pass would share and corrupt the per-pass state (the engine cache, the collect memo, the loop set). Components that call `processGraph` from a mount or render effect during a pass are the usual source.
3. **Run.** Increments the compute-overlay counter (`beginCompute`), runs the pass body, clears the dirty flag on completion, and in a `finally` clears the in-flight flag and decrements the counter (`endCompute`). The overlay (`computeOverlayStore.ts`) is a "Computing…" curtain that blocks interaction, so a multi-second pass can't interleave with a pan, drag or add. It appears only once a pass has run for 150 ms (`REVEAL_DELAY`) and then stays at least 350 ms (`MIN_VISIBLE`) so it never flashes; a pass that ends before the reveal cancels it, and a new pass cancels a pending hide.
4. **Drain.** If a rerun was requested, runs exactly one more full pass, `processGraph()` with `{ force: true }` when any coalesced request was forced (otherwise the manual-mode gate would swallow a coalesced F9), inside its own `beginForceExact` bracket when any was exact (the F9 caller's bracket has already closed by then, so sketch would otherwise sample the pass F9 asked for). A full pass is a superset of any targeted request that was coalesced, so the arguments of coalesced calls are dropped. The drain runs after the in-flight flag clears, so it never nests, and a component effect whose dependencies did not change fires nothing, so the drain cannot queue itself forever.

### The pass body (`runGraphPass`)

1. Returns immediately if the editor, engine or view refs are unset.
2. **Retarget into composites.** If `changedNodeId` is not a node of the main editor, the pass searches every composite's `internalEditor` (recursively, through nested composites) for it. On a hit, every composite on the nesting chain gets `markInternalEdit()` (an internal value edit fires no editor event, so this is how a composite holding a heavy result learns its subgraph changed), and `changedNodeId` becomes the outermost owning composite card, whose cache entry is the one that must go.
3. `clearCollectMemo()` (see Lazy Frames).
4. `resolveTrigModes(editor)`.
5. **Invalidate.** Targeted: compute the cone and delete each member's cache entry by hand, never `engine.reset(id)`. Full: `engine.reset()`. Additive: nothing.
6. **Loop set.** A targeted pass without `topology` reuses the module's cached loop set (computing it once if absent); every other pass recomputes and caches it. An additive pass follows a paste, and pasted nodes can carry a loop of their own, so it never reuses the set: an unseeded loop would leave the pass waiting on itself forever. Then `seedLoopErrors` over that set.
7. **Fetch** (`fetchAll` with `stopOnCancel`). For each node in `editor.getNodes()` order: skip it if it has left the editor since the list was taken (a node removed while an earlier fetch awaited), otherwise `await engine.fetch(id)`. On a targeted pass, before overwriting the stored value, it records the node as a sink when it has no output keys, and as changed when any output differs by identity (`!==`) from what `cableValueStore` holds for it. Then `cableValueStore.setNodeOutputs(id, outputs)`. A `Cancelled` rejection ends the pass silently (no render, no hooks); any other rejection propagates.
8. `cableValueStore.bump()`: cable value readouts re-read. The store holds the latest value per output, keyed `nodeId:outputKey` (the colon makes the node-id prefix unambiguous for `forget`), and serves a combo socket's cable color, the fallback card's preview and the group readouts.
9. **Render.** Full pass: every node. Additive: only the `renderOnly` set. Targeted: a node in the cone renders when its own outputs changed, or when it is a sink fed directly by a changed node. Nodes outside the cone never render. Object outputs are fresh references on each run, so the cutoff mostly prunes scalar chains. All selected nodes re-render concurrently through `view.rerenderNode`, which is safe because each card is its own React root.
10. With `window.__solenoidPerf = true`, logs one line per pass: mode, node and cable counts, compute and render time, IPC calls, and the five slowest nodes over half a millisecond (per-node time comes from the error guard).
11. `compositePassStore.notify()` (an open drill-in re-renders its internal cards), then the registered graph-changed hook (`setGraphChanged`; the canvas uses it to schedule an autosave and an undo step).

### What triggers a pass

| Trigger | Call |
|---|---|
| A value edit on a card (a committed field, a toggle, a pick) | `processGraph(node.id)`, or `processGraph()` where the edit changes more than values |
| A live cable created or removed (the canvas pipe, outside a rebuild scope) | FC type reconcile, then `processGraph(target, undefined, { topology: true })`, or a full topology pass when the target is gone |
| A node added live | `processGraph(id, undefined, { topology: true })` |
| Load or document switch | `processGraph()` at the end of the rebuild, still inside the rebuild scope |
| Paste | `bulkSettle(pastedIds)`: an additive pass rendering only the pasted nodes |
| Delete, composite create or unpack, undo, redo | a rebuild scope, then one `bulkSettle()` (a full pass) |
| F9, Calculate now, the status bar's Calculate, switching to Automatic or Sketch, local midnight when the document holds a volatile date | `requestRecalc()` |
| A live-data connection refresh or a background load landing | `processGraph()` outside any rebuild scope ([[#A refresh never runs inside a rebuild scope]]) |

`bulkSettle(renderOnly?)` calls the settle the canvas registered with `setBulkSettle`: FC type reconcile, a connection-version bump, the FC unit-mismatch rescan, `processGraph(undefined, renderOnly)`, then the group-collapse sync. Its default before registration is a bare `processGraph(undefined, renderOnly)`.

### The perf probe (`perfProbe.ts`)

The probe is inert unless `window.__solenoidPerf = true`. The error guard then times each node's `data()` through promise settlement (`recordNode`, keyed by node id with its class name), so an async node's IPC round trip lands in its row, and `ipcBridge` times each engine IPC call (`recordIpc`, keyed by command, with a cheap payload-size estimate). `processGraph` clears the per-pass buffer at `beginPass()`, reads the slowest nodes with `passTopNodes(n)`, and takes an IPC delta from two `ipcSnapshot()`s. From the devtools console, `window.__solenoidStats()` prints the cumulative node and IPC tables, sorted by total time, and `window.__solenoidStatsReset()` clears them.

## Calc modes and the dirty flag (`calcModeStore.ts`)

The store holds `mode: "auto" | "manual" | "sketch"`, a `dirty` boolean and a `forceExact` depth counter. It imports nothing but the notifier, so `process.ts` can import it one way.

- **Persistence.** The mode is per browser, not per document: read once at module load from `localStorage["solenoid.calcMode"]` (`"manual"` and `"sketch"` are recognized, anything else or a throwing accessor gives `"auto"`) and written on every change, with a write failure ignored so the mode lives on in memory.
- `setMode(m)` returns `false` and does nothing when `m` is the current mode. Otherwise it sets the mode, clears `dirty` when `m` is `"auto"` or `"sketch"`, persists, notifies, and returns `true`. The store never runs a pass; the caller owes the catch-up recompute. The Calculate menu calls `requestRecalc()` when switching to Automatic or Sketch returns `true`, and nothing when switching to Manual.
- `markDirty()` sets `dirty` (notifying only on a transition); `processGraph` calls it when the manual gate drops a pass. `clearDirty()` clears it (notifying only on a transition); every completed pass calls it.
- `sketchActive()` is true when the mode is `"sketch"` and `forceExact` is 0. The frame layer checks it before running a verb: while it is true a large frame is sampled down to `SKETCH_SAMPLE_ROWS` (10,000) rows and additive results are scaled back up and stamped `__approx`. Outside the frame layer, sketch computes exactly like automatic.
- `beginForceExact()` and `endForceExact()` bracket a pass that must run on full data while sketch stays selected. The bracket is a depth counter, not a boolean, so an overlapping second forced call can't clear the first one's bracket early. The counter never drops below zero.
- The status bar shows, in manual mode only, a plain "Manual" label when the graph is current and an actionable "Calculate" button (running `requestRecalc()`) when `dirty` is set.

| State | Edit | F9 | Switch to auto or sketch | Switch to manual |
|---|---|---|---|---|
| auto or sketch | pass runs | forced exact pass, new generation | no-op if same mode, else catch-up pass | mode changes, no pass |
| manual, clean | dirty set, no pass | forced exact pass, stays clean | dirty cleared, catch-up pass | no-op |
| manual, dirty | stays dirty, no pass | forced exact pass, dirty cleared | dirty cleared, catch-up pass | no-op |

### Only the calc-mode gate skips a pass

**MUST:** the calc mode and the dirty flag form the real state machine in the table above. In manual mode an edit marks the graph dirty instead of computing; switching to automatic or sketch clears the pending flag and the caller owes the catch-up recompute, since the store never runs a pass; an unavailable `localStorage` falls back to in-memory state, never to a graph that quietly stops recomputing. The entry-order gate is the only thing that drops a pass. A graph that has stopped recomputing looks exactly like one that doesn't need to, so the transitions have direct tests (`calcModeStore.test.ts`).

`requestRecalc()` increments the recalc generation, calls `beginForceExact()`, runs `processGraph(undefined, undefined, { force: true })`, and calls `endForceExact()` in a `finally`. So F9 always computes, in any mode, on full data, and re-rolls every volatile node.

## Volatile nodes and the recalc generation

`getRecalcGen()` returns a module-global integer that starts at 0 and only `requestRecalc()` increments. It is global so every "roll everything" entry point (F9, the menu, the status bar, the midnight rollover, the Save Times card) shares one clock.

A node whose `data()` draws random numbers keeps its raw draw and a `lastGen` field initialized to `-1`. In `data()` it reads `getRecalcGen()`; when that differs from `lastGen` (or the stored draws no longer match the input's length) it draws fresh raw values (uniforms in [0, 1)) and stores the generation. It then derives the output from the stored raws and the current inputs, so changing a bound rescales the same draw instead of rolling a new one ([[D46]] freezeVolatilePerCalc). Examples: RAND (`RandBetweenNode`), Shuffle, RANDARRAY, Promo, UUID and the Distribution node's sample form. Draws are not saved; a reload or a new instance rolls on its first pass.

`sourceInvariants.test.ts` fails when a file under `nodes/` or `packs/` calls `Math.random()` without referencing `getRecalcGen`, apart from a sanctioned list with reasons (`nodes/composite.ts`, which mints ids, not values).

Volatile functions inside a formula (`RAND`, `RANDARRAY`, `SHUFFLE` and the sampling functions in `excelFunctions.ts`) draw fresh values on every evaluation, so an Expression holding one re-rolls whenever that Expression is recomputed.

The midnight rollover (`volatileDates.ts`, armed once in `App.tsx`) sets one timer for a second past the next local midnight; when it fires, it calls `requestRecalc()` if the document holds a Today / Now card, a node whose `expr` or `frameText` contains `TODAY(` or `NOW(` (any case), or a Date Input holding a relative date phrase, looking inside composites too, then re-arms. TODAY and NOW read the local calendar, so their day turns at the same local midnight.

## Rebuild scopes

A rebuild scope marks the graph as being built or rewritten in bulk, as opposed to a person editing it.

- `beginGraphRebuild()` increments a depth counter; `endGraphRebuild()` decrements it, never below zero; `isGraphRebuilding()` is true while the counter is above zero. Every opener pairs its `end` in a `finally`.
- Openers: document load and its rollback (`persistence.ts`), paste, bulk delete, composite create and unpack, the Tornado sweep, the model fuzzer, and undo and redo (through `withGraphRebuild`).
- `withGraphRebuild(fn)` clears a module-level "topology dirty" flag, opens a scope, runs `fn`, closes the scope, and if a cable changed while the scope was open (the canvas pipe calls `markBulkTopoDirty()` instead of settling) runs one `bulkSettle()`. So an undo that only moved a node computes nothing. The flag is a single global, so `withGraphRebuild` does not nest.

What an open scope suppresses:

| Behavior | Where | Why it is suppressed |
|---|---|---|
| The manual-mode gate in `processGraph` (a pass runs even in manual) | `process.ts` | an opened document must not be blank |
| The per-cable settle (FC reconcile, mismatch rescan, targeted pass) on `connectioncreated` and `connectionremoved`; the dirty flag is marked instead | canvas cable pipe | per-cable settles are quadratic; one settle runs at the end |
| The per-node forget sweep on `noderemoved` | canvas pipe | a rebuild runs `forgetAllNodes()` once |
| Absorbing a newly created node into the group under it | `FlowSurface.tsx` | only a live creation is dropped into a group |
| The React Flow topology sync (retried each task until the scope closes) | `FlowCanvas.tsx` | the rebuild commits once |
| Undo-history recording | `flowHistory.ts` | a load is not an undoable step |
| Document operations (switch, create, fork and the rest) | `documentStore.ts` | they would race a half-built canvas |
| Outward effects: Alert firing, Expect violations, a relative Date Input's day change, a composite's By-Row cap warning, Problems panel logging | nodes and `problemsStore.ts` | [[D79]] effectsEdgeTriggered: a load must not replay old alerts |
| The Conduit's lane-change recompute | `ConduitComponent.tsx` | the rebuild's own settle covers it |

### A refresh never runs inside a rebuild scope

**MUST:** a live-data refresh (`refreshConnection` from the manual button or the interval timer, `refreshAllConnections`, a background load landing) runs its pass outside `beginGraphRebuild` / `endGraphRebuild`. Bulk topology operations wrap themselves in scopes on purpose; a refresh must never be one of them. A scope suppresses outward effects so a load doesn't replay old alerts ([[D79]] effectsEdgeTriggered), and a refresh inside one would swallow a real alert on fresh data: an Alert watching a live feed would simply stop firing.

The Tornado sweep opens a scope and `beginForceExact()` on purpose: its perturbation passes must run in manual mode, on full data, without raising real alerts.

## The per-node wrappers

Every editor that computes (the main canvas stack in `FlowCanvas.tsx`, the headless `buildModel` in `flow/flowModel.ts`, `StaticFlowStage.tsx`, the landing stages, and each composite's internal editor) installs, in this order, before any node is added:

1. `installInputCoercion(editor)`: a pipe that calls `wrapNodeData(node)` on `nodecreated`.
2. A pipe that calls `installErrorGuards(node)` on `nodecreated` (a composite calls `installErrorGuards` directly after each `addNode`, and on the boundary markers it creates, which gives the same order).
3. `editor.use(engine)`.

Each wrapper replaces `node.data` and is idempotent (`__coerced`, and a private symbol for the guard). Since coercion wraps first, the call chain is `guard → coercion → the node's own data()`. The guard therefore sees the raw inputs, and anything coercion throws lands in the guard ([[D35]] errorInErrorOut).

## The error guard (`installErrorGuards`, `errorValue.ts`)

On each call with `inputs`:

1. **Short-circuit.** Unless the node's constructor name is in `SEES_ERRORS` (`IFErrorNode`, `IsTestNode`, `ConduitNode`, `CableSwitchNode`, `DisplayNode`, `NoteNode`, `ReportNode`, `ChartNode`, `CompositeNode`, `CompositeOutputNode`), the guard scans each input array's top-level values for a `SolError` (`firstInputError`). On the first one found it returns error-out without calling `data()`. Errors inside a list, matrix or Frame cell do not short-circuit; the node handles those per cell.
2. **Run.** Calls the wrapped `data(inputs)`. A synchronous throw, or a rejected promise, becomes error-out of the converted error: a thrown `SolError` is itself, an error whose `name` is `"ShapeError"` becomes `#SHAPE!` with its message, anything else becomes `#ERROR!` with the message "This node failed to compute: …".
3. **Tag the result.** On success, every output value is passed through origin tagging: an untagged top-level `SolError` gets `origin: { nodeId, nodeName }`; untagged errors in a one-dimensional array's cells and in a Frame's column cells get the same plus `rowIndex`, in a copy. An origin already present is never overwritten ([[E9]] errorsKeepOrigin). When nothing needed tagging the original object is returned. Then the result is reported to the error sinks.
4. **Error-out.** Tags the error with this node as origin if it has none (with `inputSlot` set to the input key that carried it, when it came from an input), sets every current output key to the tagged error, sets `cachedResult` (and a figure card's `cachedChart`) to it and `cachedPayload` to `null` where the node has those properties, reports it to the sinks, and returns the outputs.

Error sinks (`registerErrorSink`; the Problems store registers one) receive at most one report per node per call: the first error found on the node's own outputs by `findCellError`, a bounded scan of the head and a stride sample of each container ([[error-values]], "Per-cell errors surface through a bounded scan"), or `null` when the outputs are clean, which re-arms the sink's edge detection. The Problems store (`problemsStore.ts`) is one such sink:

- It logs only at an error's origin node, since the sink fires for every relay and one failure wired to N nodes would otherwise log N rows. It logs nothing while a rebuild scope is open; the settle after a load runs outside the scope.
- It is edge-detected per node: the same code on the same node logs once, and a clean report (`null`) clears only that detection state, not the history, so a later relapse logs again.
- Entries are newest first, capped at 200. Fuzz findings (`setFuzzFindings`) replace the previous fuzz run wholesale rather than accumulating, and each may carry a suggestion that seeds a Clamp on an input, with the sweep's observed-safe `min` and `max` when it found a usable range.
- Deleting a node removes its entries, and a rebuild clears the store. `problemsPanelUi` holds the panel's open state outside the panel, so the status bar badge can open it.

With the perf probe on, the guard records each node's `data()` time, measured through promise settlement.

## Arrival coercion (`wrapNodeData`, `coerceInputs.ts`)

Coercion turns each arriving value into the shape of the rung the consuming socket declares, so `data()` is written against one shape per input. Acceptance (which cables may exist) is socket-driven and lives in [[socket-lattice]]; coercion is the runtime half and never crosses element families except by the one bridge ([[C10]] socketLattice).

### Per-call steps

1. **Collect lazy Frames.** If the node's class is not in `LAZY_FRAME_NODES` and any input array holds a `FrameRef`, every ref is collected with `readFrame` (concurrently within an input) and the call becomes asynchronous. With no ref present the call stays synchronous. A lazy node receives the ref itself.
2. **Unit boundary.** For each input key, unless units are kept for it, each arriving value goes through `stripUnitCells`, which replaces every `UnitCell` (at the top level or nested in arrays) with its display magnitude and returns the same reference when there are none ([[D42]] perInputUnitBlind). Frames and Cubes cross untouched: a Frame's unit is column metadata, and a Cube's cells keep their per-cell units so the table verbs carry them through. Units are kept on every input of a node with `unitAware = true`, and, for a node with a `passthrough()` declaration, on the inputs that declaration names (re-read each call, since it can depend on the current op). Whether the node is a passthrough is decided once, at wrap time. `unitAware` wins over the passthrough rule.
3. **Pick the rung.** The rung is the socket's `dataType`, or for an `AdoptiveSocket` its `base`, never the concrete type it adopted to color the port. An input whose socket is not a `SolenoidSocket` passes unchanged.
4. **Coerce.** A key in the node's `rawInputs` set passes unchanged. A key in `noWidenInputs` gets element coercion only (below). Every other key gets full coercion, applied to each value in the input array.
5. **Inject typed list literals.** For each input key of the node whose coerced array is empty or absent (unwired), whose socket `dataType` is `strlist`, `datelist` or `logicallist` (or `numlist` when the node's `stringLiterals` has that key), and whose `stringLiterals[key]` is non-blank text: the input becomes `[parseListLiteral(text, dataType)]`. A wired cable always wins over the literal.
6. **Call** the node's own `data(coerced)`.
7. **Stamp Frame formats.** On the result (after it resolves, for an async node), each output that is an eager `FrameValue` gets this node's per-column format picks from `frameFormatStore`: a column whose stored pick differs from its current `format` is shallow-copied with the pick; columns without a pick keep what arrived. A stamped column is a shallow copy, never a mutation, since the arriving frame is a cached value shared with every other consumer. The stamped frame is memoized on the input frame's identity and the store's version, so a frame that did not change keeps its identity across passes; the backend's upload cache and every node's own identity memo depend on that ([[D41]] formatFlowsDownstream, [[unit-flow]]).

### Full coercion, per rung

Two cases come first on every rung: a `FrameRef` or a `SolError` passes through unchanged, and a value that is or directly contains a `UnitCell` (only possible on a kept-unit input) takes the unit-cell table below. Otherwise:

| Rung | A scalar arrives | A one-element list | A longer list | A matrix | `null` |
|---|---|---|---|---|---|
| `number` | as is (logical becomes 1 or 0) | its element | `#SHAPE!` | 1×1 gives its element, larger is `#SHAPE!` | `null` |
| `list` | `[x]` | as is | as is | 1×N or N×1 flattens, M×N is `#SHAPE!` | `null` |
| `numlist` (number combo) | as is | its element | as is | flattened like `list`, then a single element collapses | `null` |
| `table` | `[[x]]` | one row `[[x]]` | one row | as is, keeping a matrix unit tag | `null` |
| `logical`, `logicalcombo` | as is (number becomes a logical) | its element | as is | a one-row matrix becomes its row, otherwise as is | `null` |
| `logicallist` | `[x]` | as is | as is | as is | `null` |
| `logicaltable` | as is | as is | as is | as is | `null` |
| `string`, `date`, `complex`, `strcombo`, `datecombo`, `complexcombo`, `anycombo`, `anydata` | as is | its element | as is | a one-row matrix becomes its row, otherwise as is | `null` |
| `strlist`, `datelist`, `complexlist`, `anylist` | `[x]` | as is | as is | as is | `null` |
| `frame` | a 1×1 Frame | a one-row Frame | a one-row Frame | a Frame with one row per matrix row | `null` |
| `cube` | a 1×1 Cube | a one-row Cube | a one-row Cube | a Cube with one row per matrix row | `null` |
| every other rung (`strtable`, `datetable`, `complextable`, `anytable`, `any`, `trueany`, `lambda`, `chart`, `document`) | as is | as is | as is | as is | `null` |

Details the table compresses:

- **The logical and number bridge.** On the number-family rungs (`number`, `list`, `numlist`, `table`) every boolean, at any depth, becomes 1 or 0 before shaping. On the logical-family rungs every number, at any depth, becomes `value !== 0`, and `NaN` becomes `null` (unknown, not true). `null` passes both ways. This is the only cross-family conversion coercion performs ([[C10]] socketLattice). Any other family's value on a typed rung of the number, date, string or logical family (only a wildcard cable can land one there) is `#TYPE!` (`familyCells`): text or a complex where a number or a logical is expected, text, a logical or a complex where a date is expected (a date is a number at runtime, so a number passes), and anything but text where text is expected. It is a cell of the list or matrix, or, as a lone value on a scalar or combo rung, the node's result ([[B17]] typedValueModel). The complex family takes what it is given.
- **Singleton collapse.** A one-element array becomes its element on the scalar and combo rungs listed above; the check is only the outer length, so a one-row matrix collapses to its row. A strict list rung keeps a one-element list and wraps a lone scalar, so a combo to list round trip is lossless. The complex scalar is a tagged object, not an array, so it never collapses apart.
- **Widening.** A value only moves up in rank ([[C10]] socketLattice): a scalar or list widens into `table` as one row (CSV orientation; a column takes a Transpose), and into `frame` and `cube` the same way. Narrowing happens only where a combo or scalar rung collapses a singleton; a real narrowing failure throws `ShapeError`, which the guard renders as `#SHAPE!` ([[D35]] errorInErrorOut). An empty list reaching `number` is `#SHAPE!` ("Expected a single value, got 0"); reaching `list` or `table` it stays empty.
- **The shape helpers** (`nodes/coerce.ts`). `toMatrix` only widens and never fails: a scalar is 1×1, a list one row, a matrix unchanged. `toList` wraps a scalar, flattens a 1×N or N×1 matrix and throws `ShapeError` on a real M×N table. `toScalar` flattens and throws `ShapeError` on more than one element. A scalar is any value that is not an array, so a value that reaches a rung through a wildcard (`trueany` accepts everything) is one value, never a list of its characters. `toAnyMatrix` is `toMatrix` for any element type. `matrixShape(v)` is the one row and column count that the Table Info node's outputs and the COLUMNS and ROWS formulas share ([[C17]] shareImpl): a list is one row, a scalar is 1×1, and a wired blank is unknown (`null`). A Frame has its own real shape, so the node handles it before calling this, and Frames never reach formulas. The error guard recognizes `ShapeError` by its `name`.
- **Frame and Cube construction.** `frameFromRows(rows)` makes one column per position of the widest row, headers `Col1`, `Col2`, … and column types inferred from the cells. A `FrameValue` arriving at `frame` passes unchanged. `toCube` passes a Cube, converts a Frame with `frameToCube`, and builds from rows otherwise.
- **Rungs without widening.** The typed matrix rungs other than `table` (`strtable`, `datetable`, `complextable`, `logicaltable`) and `anytable` do not widen at arrival; the node widens with `toAnyMatrix` itself. `any` does not collapse a singleton. `anycombo` and `anydata` get no element coercion and no widening, so a scalar stays a scalar; on `anydata` a matrix flows whole, because the formula evaluator owns the rank semantics ([[formula-language#Broadcasting]]).
- **Why the strict list rungs wrap a lone value.** Without the wrap, a node's `for...of` over the input throws on a number and walks a string one character at a time.

**Unit-cell coercion** (kept-unit inputs whose value is a `UnitCell` or an array directly holding one): shapes by rank without the numeric coercers, which would reject a cell object.

| Rung | Behavior |
|---|---|
| `number` | a cell as is; a one-element array of a cell gives the cell; anything else is `#SHAPE!` |
| `list`, `anylist` | a lone cell becomes `[cell]`; an array as is |
| `numlist` | as is (a scalar cell stays scalar) |
| `table` | `toAnyMatrix`: a cell is 1×1, a list is one row |
| `frame` | a Frame as is, an array is one row, a cell is 1×1 |
| `cube` | `toCube` |
| any other rung | as is |

### Element coercion only (`noWidenInputs`)

For a key in `noWidenInputs` the value reaches `data()` at its natural rank. A `FrameRef`, a `SolError` or a unit-bearing value passes unchanged; otherwise, when the rung's element family is number, booleans become 1 or 0, and when it is logical, numbers become logicals (`NaN` to `null`). The socket and acceptance are unchanged. Expression keeps this set live by mutating it in place as its variables change.

### `rawInputs`

A key in `rawInputs` skips coercion entirely (the unit boundary and the lazy collect still apply). A polymorphic node uses it to branch on the runtime shape itself, for example a `cube` socket that must receive a Frame as a Frame rather than have `toCube` flatten its types. A broadcaster declares a combo rung instead of opting out.

### Typed list literals (`parseListLiteral`)

The text is parsed as one CSV line (a quoted field keeps an embedded comma), each field trimmed, empty fields dropped. Per rung:

- `numlist`, `list`: a finite number, or `null` for a field that is not one.
- `datelist`: `parseDate` of each field; an unparseable one is `null`. An ambiguous date such as `02-03-2026` stays its `#AMBIGUOUS!` error, because it is a question to the user, and a blank would answer it silently.
- `logicallist`: `yes`, `y`, `t` are true; `no`, `n`, `f` are false (case-insensitive); anything else goes through `coerceLogical` (TRUE, FALSE, 1, 0), else `null`. The extra spellings live only in the literal parser (`parseBoolText`), because widening `coerceLogical` would change how every wired value coerces.
- `strlist`: the fields as text.

An unparseable field is `null` in place, never dropped (which would shift later positions) and never `false` (which would assert a value nobody typed). Literal maps are restored on load only onto classes that declare them ([[inline-literal-maps]]); `coerceInputs.test.ts` fails when a catalog node with a typeable list input does not declare `stringLiterals`.

## What `data()` receives

- `inputs[key]` is an array with one coerced value per cable into that input. An input with no cable has no key, so `inputs[key]` is `undefined`, apart from an injected list literal.
- A wired cable carrying a blank arrives as `[null]`, and that is a real missing value. `readInput(inputs.key, literal)` (`nodes/shared.ts`) returns the literal only when the input is unwired (`undefined` or empty) and otherwise the first value, with `undefined` read as `null` ([[D33]] unwiredNotBlank). A read of the form `inputs.key?.[0] ?? literal` would swallow the wired blank; what a node then does with it, by the input's role, is [[value-semantics]] "Reading an input".
- A value is never a `SolError` at the top level unless the node is in `SEES_ERRORS`, because the guard answered for it. The exception is a lazy Frame that failed to collect (next section).
- A value never contains a `UnitCell` unless units are kept for that input.
- A value is never a `FrameRef` unless the node is lazy. The collect runs before `rawInputs` is consulted, so a raw input on an eager node still receives a collected Frame.

## Lazy Frames and when they are collected

A Frame on a cable is usually a `FrameRef`: a handle to a verb chain held by the frame backend ([[C16]] polarsEngine). The classes in `LAZY_FRAME_NODES` (matched by constructor name) receive refs uncollected: the relational verbs (Distinct, Head, Sort, Filter, Join, Columns, GROUPBY, Unpivot, Append, Bind Columns, Rename, Fill Blanks, Replace Values, Window) and the nodes that read through the cheap primitives (Get Column, SUMIFS, Table Info, Write File, Pivot, Slicer). `lazyChain.test.ts` pins the set. Every other node's inputs are collected to an eager `FrameValue` at arrival.

`readFrame(ref)` flushes the ref's pending plan to a handle (one backend round trip, rebased on the longest prefix already flushed this pass), collects it, applies the sketch scaling and the aggregate guard, and memoizes the resulting promise by the ref object. `clearCollectMemo()` at the start of each pass (the app's and `computeAll`) empties the flush and collect memos and drops the flushed handles, so a ref fanned out to several consumers materializes once per pass and never across passes. A collect failure resolves to a `SolError` value (`materialize`) rather than throwing. The coercion wrapper then throws it, so the error guard sends it out every output without running the node; a class in `SEES_ERRORS` receives it as a value instead ([[D35]] errorInErrorOut).

## Composites

A composite card owns a private `NodeEditor` and `DataflowEngine`, wrapped in the same order, and nothing inside it enters the outer engine or cache. Its pass writes each input port's value into its input marker, runs `internalEngine.reset()`, seeds `#CIRC!` on its internal loop members (with a message pointing at Simulation mode), and fetches only the output markers. Run modes and heavy-mode holding ([[D52]] compositesHoldUntilSolve) are [[composite-nodes]], and the drill-in is [[composite-drill-in-mount-lifecycle]]; this file only supplies the retargeting in the app pass above.

## Enforcement

- `processTargeted.test.ts`: the cone includes the start and every transitive dependent across branches and joins, and terminates on a cycle.
- `circularReset.test.ts`: closing a cycle with a live cable, or pasting one, yields `#CIRC!` on the members instead of a stack overflow or a hung pass.
- `processReentrancy.test.ts`: a recompute fired during a pass runs no nested pass and settles as one rerun; a coalesced forced call stays forced, and a coalesced F9 in sketch mode stays exact.
- `calcModeStore.test.ts`: the mode and dirty-flag transitions, notification on each transition only, and a missing `localStorage`.
- `coerceInputs.test.ts`: typed-literal injection and declaration, the adoptive base rung, `noWidenInputs`, singleton collapse per family, strict list rungs, and the `FrameRef` bridge for lazy and eager classes.
- `errorValue.test.ts`, `errorIntegration.test.ts`: the guard's short-circuit, conversion, origin tagging, and coercion `#SHAPE!` through a real engine.
- `sourceInvariants.test.ts`: the `Math.random` and `getRecalcGen` scan.
- `broadcastContract.test.ts`: the unwired and wired-blank read.
