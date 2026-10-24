---
aliases: ["Graph core"]
tags: [spec, computation]
---
<!-- [[D102]] graphOnCore, [[C130]] rustCore, [[C23]] calcModes -->

# Spec: the graph core

Serves [[D102]] graphOnCore and [[C130]] rustCore. The graph model, the dataflow engine, the input boundary every
node's call goes through, the compute pass and its state run in Rust: `crates/solenoid-graph`, built on [Ruggine](https://github.com/bubba8587/ruggine), the Rust
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
  app's first render waits for `loadGraphEngine()` with no deadline (`main.tsx`); creating an engine before it loads
  throws. Tests load it in `tests/setup/graphEngine.ts`; a Node script reads the bytes at `graphWasmUrl` and calls
  `loadGraphEngineSync` (`scripts/run-graph.ts`, run through `scripts/vite-run.mjs` like every script that imports
  the app).

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
- **Ids are the core's.** `getUID()` (`graphModel.ts`) is Ruggine's `get_uid` (`uid()` in the graph module): sixteen
  lowercase hex digits from eight secure random bytes, drawn from the platform in batches. A node or cable built
  before the module loads throws.
- **What TypeScript still holds** (until the node bodies and their state move, D102's later phases): each node's
  JavaScript object (its class, fields, `data()`) and each cable's, kept in the core beside the Rust node and cable and
  in the handle's id → object maps. `getNode` and `getConnection` look up the map; `getNodes()` and
  `getConnections()` return a fresh array (rete's `slice()`) of a list rebuilt once per change, in the core's
  insertion order, so a loop over them never crosses into the module.
- **Node classes are `GraphNode`s** (`graphModel.ts`, with `GraphSocket`, `GraphInput`, `GraphOutput` and
  `GraphConnection`, Solenoid's own in place of rete's classic preset). While a node is in an editor, `addInput`,
  `removeInput`, `addOutput`, `removeOutput`, `moveInputLast`, assigning a port's `socket` and a `MutableSocket`'s
  `setType` reach the core too: the node tells its editors (`PortListener.portsMoved`), each queues it, and the node's
  ports as they then stand go over in one `setPorts` call per node, before the next call into the core or when a
  node's `data()` returns (a node may change its own sockets while it computes). `inputs` and `outputs` are
  read-only to everything else, so no other path can change a key set behind the core's back. `new GraphConnection(...)` fails when the source output or target input
  is missing, as rete's did; the editor itself doesn't check.
- **Signals come from the core's scope.** `addPipe(pipe)` adds a pipe to the editor's Ruggine scope, after every pipe
  already there; the engine sits where `use(engine)` was called. The core calls each pipe with `{ type, data }`, `data`
  being the node's or cable's JavaScript object, for `nodecreate`, `nodecreated`, `noderemove`, `noderemoved`,
  `connectioncreate`, `connectioncreated`, `connectionremove`, `connectionremoved`, `clear`, `clearcancelled` and
  `cleared`, in rete's order (`clear` removes every cable, then every node, one signal each). A pipe returns the
  context to go on; returning nothing stops the chain, which on a present-tense signal cancels the change (the edit
  answers `false`, and a cancelled `clear` signals `clearcancelled`). A pipe that throws stops the chain and the edit
  rejects with what it threw. Pipes are synchronous. The handle's own pipe is the first, so `getNode(id)` answers in a
  `nodecreated` pipe and not in a `nodecreate` one, as rete's did.
- **A composite's own editor is known to the one holding it.** When a node with an `internalEditor` joins an editor,
  that editor's core records the inner one's (`nest`; `unnest` when it leaves), so the pass can retarget an edit made
  inside it (§ The pass).
- **Edits finish before they return.** `addNode` and the other edits return promises, as rete's did, but the change
  and all its signals have run when the call returns, where rete's landed a microtask or more later.
- Rete's errors keep their messages: adding an id twice ("node has already been added"), removing a missing node or
  cable ("cannot find node", "cannot find connection").

## The engine (`dataflowEngine.ts`, `wasm.rs`)

- `DataflowEngine` keeps rete-engine's shape: a handle attached with `editor.use(engine)`, after which its calls run
  on that editor's core. Nodes already in the editor when it is attached are registered then. Before that, a call
  fails with "DataflowEngine isn't attached to NodeEditor".
- The nodes stay the app's JavaScript objects. The core calls the node's own `data(inputs)` with the node as `this`
  through the input boundary (§ The input boundary), awaits a returned promise, and takes any other return as the
  outputs. `new DataflowEngine({ raw: true })` calls `data()` as it is, rete-engine's shape, for the engine's own tests.
  The input and output keys are the core's (§ The model), so a node that changes its sockets needs nothing
  re-registered.
- `compute(id, inputs)` runs one node of the editor as a fetch would, boundary included, without reading or filling
  its cache (a composite's simulation steps); `computeNode(node, inputs, data?)`, outside any editor, runs a node
  object through the boundary with its ports read off the object, answering at once when nothing it does waits (the
  tests drive one node this way, `tests/graph/boundaryKit.ts`).
- **Values cross by reference**: an output value is the same object in every input it reaches and in what `fetch`
  returns, so the pass's change test by identity holds. The outputs object `fetch` returns is built per fetch, in the
  node's key order; `fetchAll` hands `onNode` the same object it puts in its map.
- **Errors**: through the boundary, a throw or rejection from `data()` is the guard's error value on every output. On
  a raw engine it rejects the fetch with that same value. A reset clearing a fetch in
  flight rejects it with a new `Cancelled` (`dataflowEngine.ts`), and a `Cancelled` a node passes up from an inner
  engine counts as a cancellation, as rete-engine's `instanceof` read it. The engine's own failures ("node is not
  initialized", missing outputs) are plain `Error`s with rete-engine's messages.
- **The cache** is not exposed. `seed(id, outputs)` gives a node a result without running it (loop seeding, a
  composite's simulation state), `forget(id)` clears one node's entry, `reset()` clears all.
- Where Ruggine differs from rete-engine is Ruggine's `tree/specs/port.md`; the one a node could see: a cable whose
  source returned no value under its output key adds nothing to the input's list, where rete-engine added
  `undefined`.

## The graph walks and the pass (`pass.rs`, `wasm.rs`)

The engine answers the walks over its editor's graph and runs the pass; `graphCompute.ts` reaches them for an editor through
`engineOf(editor)`:

| Call | Behavior |
|---|---|
| `loopMembers()` | Self-cabled nodes in cable order, then each strongly connected component of two or more, as an iterative Tarjan walk closes it. A cable to a node not in the editor is ignored. |
| `downstreamClosure(id)` | `id` and every node its cables reach, breadth first, each once. |
| `invalidate(id, keepCaches)` | With a node: clears its cone's caches and returns the cone. Without one: `reset()` unless `keepCaches`, and `null`. |
| `fetchAll(onNode?, stopOnCancel)` | Fetches every node in the editor's order, skipping one removed mid-pass; a cancelled fetch records `null`, or with `stopOnCancel` ends the pass with `null`; any other rejection rejects the pass. |
| `seedLoops(message?)` | The loop members, each seeded with `#CIRC!` on every output and its card's cached fields ([[compute-pass]] § The model pass). |
| `computeAll(id?)` | The model pass: `invalidate(id, false)`, `seedLoops()`, `fetchAll()`. |
| `pass(changed?, renderOnly?, topology, onNode)` | The app's pass body ([[compute-pass]] § The pass body): `changed` retargeted to the outermost composite holding it (each on the way marked edited), `invalidate`, the editor's cached loop set (reused by a value edit's targeted pass), seeding, `fetchAll` with stop on cancel and `onNode(id, outputs)` answering whether the node's outputs changed, then the nodes to re-render in the editor's order (`render_set`); `null` when a reset cancelled it. |
| `markNested(id)` | Marks every composite holding `id` as edited inside and answers the outermost one. |

## The input boundary (`boundary.rs`, `nodeBoundary.ts`)

The engine's call of every node: the error guard, the lazy frames' collect, the unit boundary, each rung's coercion and
the typed list literals on the way in; the frame format stamp and the guard's origin tagging on the way out
([[compute-pass]] § The per-node wrappers, § The error guard, § Arrival coercion, which own the behavior). The values
are walked in place through `js_sys`; each array's cell kinds come over in one call (`cellKinds`), so a walk touches
only the cells it changes. What only the app knows comes from `nodeBoundary.ts` through `setBoundaryHost`, which
`dataflowEngine.ts` imports, so any engine has it.

## The session (`session.rs`, `passSession.ts`)

The compute pass's state between passes: the calc mode, the dirty flag, the force-exact depth, the recalc generation,
the rebuild depth and its topology flag, the single-flight flag and the rerun a pass in flight coalesces. One per
module, as the pass is one per app. Every transition is the core's (`sessionEnter`, `sessionExit`, `sessionSetMode` and
the rest); `passSession.ts` keeps the snapshot each answers, which is what `calcModeStore`, `getRecalcGen()` and
`isGraphRebuilding()` read without crossing. The mode a browser persisted is handed over when the module loads.

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
- the fresh instance gets the boundary's host again and takes back the session's last snapshot (`whenGraphEngineLoads`);
  a rerun a pass had coalesced is gone;
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

Moving the boundary, the pass and its state into the core (2026-10-24, same test, two runs each) left the compute phase
level (1232 nodes: 95 and 102 ms before, 100 and 100 after). On large values the boundary is faster than the
TypeScript wrappers were (median of 20, one node through the boundary, Node): a 100k list on a `list` port 1.3 ms
(4.9), a 300 × 300 table on `table` 1.5 ms (2.5), a 100k × 5 frame answered and tagged 3.0 ms (3.9); a scalar costs
about 0.05 ms against 0.01. Walking each cell across the boundary had made the same list 25 ms, which `cellKinds`
removed. Loading personal-finance in the built app (Chromium, three loads): cards settled in 3.1 s and the first full
pass computed in 481 ms, against 3.3 s and 507 ms before.

## What blocks phase C (card bodies called with no JavaScript hop)

- **The values are JavaScript objects.** The engine holds `JsValue`s and every card body on the core (`nodeOnCore.ts`)
  encodes its inputs into the core's wire and decodes its answer, in a second module (`engineWasm/`). Calling a body
  directly needs the values in Rust between cards, with their identity (the change test, the format and frame memos,
  the backend's upload cache, which key on the object) carried by something other than object identity.
- **Two modules.** The graph and the card bodies are separate instances so a formula's trap can't take the graph
  with it ([[rust-core]] § Where it runs). One call from the graph into a body needs either one module (and a trap
  story for it) or a host hop between them.
- **What the boundary still asks TypeScript for**: lazy frames (`readFrame`, the frame backend's plans), building a
  frame or cube from rows, unit display magnitudes (the FC unit catalog's resolvers), list literal reading
  (`coerceFrameCell`, date text), format picks (`frameFormatStore`), display names (the catalog), the error sinks
  (the Problems store) and the perf probe. Each is a TypeScript module the card bodies would need from Rust too.
- **Per-node state on the JavaScript object**: `cachedResult` and the other fields the guard and loop seeding set,
  `lastGen` and the volatile draws, `_resolvedAngleMode` (`resolveTrigModes`, which walks the FC annotations in
  TypeScript), a composite's `markInternalEdit`; `static coreFields` already sends what a body reads.
- **Cards whose bodies are still TypeScript** (node-bodies.md's table): a direct call covers only the ported ones.

## Enforcement

- `cargo test --manifest-path crates/solenoid-graph/Cargo.toml`: the walks, the model and its port sets
  (`tests/model.rs`), the session's transitions (`tests/session.rs`), natively.
- `coreBoundary.test.ts`: the input boundary's frozen answers (`fixtures/core/boundary-*`).
- `dataflowEngine.test.ts`: values by reference, errors as themselves, `Cancelled`, seeding, attaching late.
- `graphEditor.test.ts`: signal order, a cancelling pipe, a throwing pipe, removed pipes, ports and their order in
  the core, the lists.
- Ruggine's own suite and its oracle against the pinned rete-engine.
- The whole vitest suite runs on it, every seed included.
