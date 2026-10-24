---
aliases: ["Graph core"]
tags: [spec, computation]
---
<!-- [[D102]] graphOnCore, [[C130]] rustCore, [[C23]] calcModes -->

# Spec: the graph core

Serves [[D102]] graphOnCore and [[C130]] rustCore. The graph model, the dataflow engine and the compute pass's
graph walks run in Rust: `crates/solenoid-graph`, built on [Ruggine](https://github.com/bubba8587/ruggine), the Rust
port of rete and rete-engine kept as its own library. What the pass does with them is [[compute-pass]]; this file
owns how the model and the engine are hosted.

## The module

- **Its own WebAssembly module**, `src/graph/graphWasm/`, apart from the formula core's `engineWasm/`. The formula
  core is dropped and instantiated afresh after a trap ([[rust-core]] § Where it runs), and a node's formula call runs
  while the graph's own frames are on the stack; one instance would lose the graph to any trapping formula.
- **Built** by `npm run build:wasm` (`node scripts/build-wasm.mjs graph` for this one) and stamped like the core
  (`source-stamp.txt`, `wasmStamp.test.ts`).
- **Ruggine is pinned** by git revision in `crates/solenoid-graph/Cargo.toml`. Moving the pin: change the `rev`, run
  `cargo test --manifest-path crates/solenoid-graph/Cargo.toml`, rebuild, run the suite.
- **Required.** Nothing computes without it, so there is no TypeScript fallback and no setting turns it off. The
  app's first render waits for `loadGraphEngine()` with no deadline (`main.tsx`). An editor or engine made before it
  loads is fine, since the core is built on first use (`GraphEditor.core()`); the first edit then rejects with "the
  graph engine isn't loaded". Tests load it in `tests/setup/graphEngine.ts`; a Node script reads the bytes at
  `graphWasmUrl` and calls `loadGraphEngineSync` (`scripts/run-graph.ts`, run through `scripts/vite-run.mjs` like
  every script that imports the app).

## The model (`graphEditor.ts`, `graphModel.ts`, `model.rs`)

- **The graph is a Ruggine `NodeEditor`**, one per editor, in `GraphCore` (`wasm.rs`, over `model.rs`'s `Graph`):
  which nodes exist and in what order, each node's input and output keys in JavaScript key order with each port's
  socket type, and the cables between them. The socket type is the socket's `name`, its declared rung (an
  `AdoptiveSocket`'s base, never the type it adopted). The dataflow engine is attached to that same editor, so
  nothing is mirrored and a fetch reads port keys without calling into JavaScript.
- **TypeScript holds a handle**, `GraphEditor`, with the method names the app called on rete's editor: `addNode`,
  `removeNode`, `addConnection`, `removeConnection`, `clear`, `getNode`, `getNodes`, `getConnection`,
  `getConnections`, `addPipe`, `use`, plus `removePipe` and `reorderNodes` (the stacking order, a full order or
  nothing, no signal; Ruggine's `reorder_nodes`). Every edit is made in the core; the handle's own lists
  change only when the core's signals say so.
- **What TypeScript still holds** (until the node bodies and their state move, D102's later phases): each node's
  JavaScript object (its class, fields, `data()`) and each cable's, kept in the core beside the Rust node and cable and
  in the handle's id → object maps. `getNode` and `getConnection` look up the map; `getNodes()` and
  `getConnections()` return a fresh array (rete's `slice()`) of a list rebuilt once per change, in the core's
  insertion order, so a loop over them never crosses into the module.
- **Node classes are `GraphNode`s** (`graphModel.ts`, with `GraphSocket`, `GraphInput`, `GraphOutput` and
  `GraphConnection`, Solenoid's own in place of rete's classic preset). While a node is in an editor, `addInput`,
  `removeInput`, `addOutput`, `removeOutput`, `moveInputLast`, assigning a port's `socket` and a `MutableSocket`'s
  `setType` are made in the core too. `inputs` and `outputs` are read-only to everything else, so no other path can
  change a key set behind the core's back. `new GraphConnection(...)` fails when the source output or target input
  is missing, as rete's did; the editor itself doesn't check.
- **Signals come from the core's scope.** `addPipe(pipe)` adds a pipe to the editor's Ruggine scope, after every pipe
  already there; the engine sits where `use(engine)` was called. The core calls each pipe with `{ type, data }`, `data`
  being the node's or cable's JavaScript object, for `nodecreate`, `nodecreated`, `noderemove`, `noderemoved`,
  `connectioncreate`, `connectioncreated`, `connectionremove`, `connectionremoved`, `clear`, `clearcancelled` and
  `cleared`, in rete's order (`clear` removes every cable, then every node, one signal each). Each pipe gets a fresh
  `{ type, data }`: what a pipe returns is never passed on, only whether it returned something. Returning anything
  goes on; returning nothing (`undefined` or `null`) stops the chain, which on a present-tense signal cancels the
  change (the edit answers `false`, and a cancelled `clear` signals `clearcancelled`). A pipe that throws stops the
  chain and the edit rejects with what it threw. Pipes are synchronous. The handle's own pipe is the first, so
  `getNode(id)` answers in a `nodecreated` pipe and not in a `nodecreate` one, as rete's did.
- **Edits finish before they return.** `addNode` and the other edits return promises, as rete's did, but the change
  and all its signals have run when the call returns, where rete's landed a microtask or more later.
- Rete's errors keep their messages: adding an id twice ("node has already been added"), removing a missing node or
  cable ("cannot find node", "cannot find connection").

## The engine (`dataflowEngine.ts`, `wasm.rs`)

- `DataflowEngine` keeps rete-engine's shape: a handle attached with `editor.use(engine)`, after which its calls run
  on that editor's core. Nodes already in the editor when it is attached are registered then. Before that, a call
  fails with "DataflowEngine isn't attached to NodeEditor".
- The nodes stay the app's JavaScript objects. The core calls `node.data(inputs)` with the node as `this`, awaits a
  returned promise, and takes any other return as the outputs. The input and output keys are the core's (§ The
  model), so a node that changes its sockets needs nothing re-registered.
- **Values cross by reference**: an output value is the same object in every input it reaches and in what `fetch`
  returns, so the pass's change test by identity holds. The outputs object `fetch` returns is built per fetch, in the
  node's key order; `fetchAll` hands `onNode` the same object it puts in its map.
- **Errors**: a throw or rejection from `data()` rejects the fetch with that same value. A reset clearing a fetch in
  flight rejects it with a new `Cancelled` (`dataflowEngine.ts`), and a `Cancelled` a node passes up from an inner
  engine counts as a cancellation, as rete-engine's `instanceof` read it. The engine's own failures ("node is not
  initialized", missing outputs) are plain `Error`s with rete-engine's messages.
- **The cache** is not exposed. `seed(id, outputs)` gives a node a result without running it (loop seeding, a
  composite's simulation state), `forget(id)` clears one node's entry, `reset()` clears all.
- Where Ruggine differs from rete-engine is Ruggine's `tree/specs/port.md`; the one a node could see: a cable whose
  source returned no value under its output key adds nothing to the input's list, where rete-engine added
  `undefined`.

## The graph walks (`pass.rs`)

The engine answers the walks over its editor's graph; `graphCompute.ts` reaches them for an editor through
`engineOf(editor)`:

| Call | Behavior |
|---|---|
| `loopMembers()` | Self-cabled nodes in cable order, then each strongly connected component of two or more, as an iterative Tarjan walk closes it. A cable to a node not in the editor is ignored. |
| `downstreamClosure(id)` | `id` and every node its cables reach, breadth first, each once. |
| `invalidate(id, keepCaches)` | With a node: clears its cone's caches and returns the cone. Without one: `reset()` unless `keepCaches`, and `null`. |
| `fetchAll(onNode?, stopOnCancel)` | Fetches every node in the editor's order, skipping one removed mid-pass; a cancelled fetch records `null`, or with `stopOnCancel` ends the pass with `null`; any other rejection rejects the pass. |

## Traps

A panic in the core runs the module's panic hook (`setPanicHandler`) before the trap; a trap with no panic (a stack
overflow) surfaces as a `WebAssembly.RuntimeError` at the call that crossed in. Either way:

- every fetch and `fetchAll` still waiting rejects with `GraphTrap`, and so does the call that trapped, so a pass ends
  instead of waiting forever;
- once the stack has left the module (a microtask later), the instance is dropped and the compiled module
  instantiated afresh (`__wbg_reset`), and every live `GraphEditor` builds a new core from what its handle holds:
  its pipes and the engine in their order, then its nodes (with their ports as they stand) and cables, with the
  pipes held silent so nothing reruns a node's install or a canvas sync. The engine's caches start empty, so the
  next pass recomputes everything; until then a call throws `GraphTrap`;
- what the dead instance left in JS never reaches the new one: `build-wasm.mjs` patches wasm-bindgen's glue so a
  dead instance's closure (a node's promise settling late) does nothing, its finalizers free nothing, and the object
  heap starts empty. The build fails if the glue reads differently.

`graphTrap()` is the tests' trigger (`graphTrap.test.ts`).

## Performance

`PERF=1 npx vitest run tests/graph/perfScaling.test.ts`: the personal-finance seed copied 2 to 8 times, a full
reset and a fetch of every node, median of 30, Node, measured 2026-10-22 against rete-engine 2.1.0 on the same
machine. Node `data()` work is in both columns; rete-engine's per-node cost stayed flat while the core's fell.

| nodes | rete-engine ms | graph core ms |
| ---: | ---: | ---: |
| 308 | 18.5 | 13.4 |
| 616 | 38.2 | 23.5 |
| 1232 | 88.3 | 39.5 |

Moving the model into the core (2026-10-23, same test, a loaded machine, two runs each) left the compute phase level
(1232 nodes: 101 to 106 ms before, 90 to 92 after) and halved building the graph (1232 nodes: 99 to 152 ms before, 47
to 76 after): `getNodes()` and `getConnections()` hand out a cached list and never cross into the module.

## Enforcement

- `cargo test --manifest-path crates/solenoid-graph/Cargo.toml`: the walks and the model (`tests/model.rs`), natively.
- `dataflowEngine.test.ts`: values by reference, errors as themselves, `Cancelled`, seeding, attaching late.
- `graphEditor.test.ts`: signal order, a cancelling pipe, a throwing pipe, removed pipes, ports and their order in
  the core, the lists.
- Ruggine's own suite and its oracle against the pinned rete-engine.
- The whole vitest suite runs on it, every seed included.
