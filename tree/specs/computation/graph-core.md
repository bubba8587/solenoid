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

- **One WebAssembly module with the core**, `src/graph/engineWasm/`: `crates/solenoid-graph` depends on
  `crates/solenoid-core` and is the one `cdylib`, so the engine calls a card's body in Rust (§ Direct calls) and the
  formula core's commands (`engine_invoke` and the rest) come out of the same instance. A trap anywhere takes the
  graph with it, which the graph survives by rebuilding from its handles (§ Traps); the author traded the separate
  instance for direct calls (2026-10-24).
- **Built** by `npm run build:wasm` and stamped over both crates and the vendored ones (`source-stamp.txt`,
  `wasmStamp.test.ts`).
- **Ruggine is pinned** by git revision in `crates/solenoid-graph/Cargo.toml`. Moving the pin: change the `rev`, run
  `cargo test --manifest-path crates/solenoid-graph/Cargo.toml`, rebuild, run the suite.
- **Required.** Nothing computes without it, so there is no TypeScript fallback and no setting turns it off. The
  app's chrome renders at once while `startCore()` (`coreReady.ts`) loads it; the surfaces that build a graph (the
  canvas, the landing scenes, the node showcase) render nothing until `useCoreReady()` says it has loaded. An editor or
  engine made before it loads is fine, since the core is built on first use (`GraphEditor.core()`); the first edit then
  throws "the wasm engine isn't loaded". Tests load it in `tests/setup/graphEngine.ts`; a Node script reads the bytes
  at `wasmUrl` and calls `loadWasmEngineSync` (`scripts/run-graph.ts`, run through `scripts/vite-run.mjs` like every
  script that imports the app).

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
- **What TypeScript still holds**: each node's JavaScript object (its class, its saved fields, the `data()` of a card
  that isn't direct) and each cable's, kept in the core beside the Rust node and cable and in the handle's id →
  object maps; a direct card's shown fields live on the Rust node (§ Direct calls). `getNode` and `getConnection` look up the map; `getNodes()` and
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
  `cleared`, in rete's order (`clear` removes every cable, then every node, one signal each). Each pipe gets a fresh
  `{ type, data }`: what a pipe returns is never passed on, only whether it returned something. Returning anything
  goes on; returning nothing (`undefined` or `null`) stops the chain, which on a present-tense signal cancels the
  change (the edit answers `false`, and a cancelled `clear` signals `clearcancelled`). A pipe that throws stops the
  chain and the edit rejects with what it threw. Pipes are synchronous. The handle's own pipe is the first, so
  `getNode(id)` answers in a `nodecreated` pipe and not in a `nodecreate` one, as rete's did.
- **A composite's own editor is known to the one holding it.** When a node with an `internalEditor` joins an editor,
  that editor's core records the inner one's (`nest`; `unnest` when it leaves), so the pass can retarget an edit made
  inside it (§ The pass).
- **An editor that's done frees its core** (`dispose`). The core holds every node's and cable's object, each pipe and
  the editor's own callbacks as JavaScript values the garbage collector can't reach past, so a core nothing frees keeps
  its whole graph alive. `dispose` hands each field the core held back to its node (`release`, as a node leaving does),
  frees the core and the cores of the composites inside, and the next call builds a core again from the handle, as
  after a trap. A composite leaving its editor frees its own editor's core; a stage that builds its own editor (the
  landing graph, a scene, the showcase) frees it when it unmounts; `removePipe` drops the pipe's function.
  `graphEditorDispose.test.ts` holds it to the garbage collector.
- **Edits finish before they return.** `addNode` and the other edits return promises, as rete's did, but the change
  and all its signals have run when the call returns, where rete's landed a microtask or more later.
- Rete's errors keep their messages: adding an id twice ("node has already been added"), removing a missing node or
  cable ("cannot find node", "cannot find connection").

## The engine (`dataflowEngine.ts`, `wasm.rs`)

- `DataflowEngine` keeps rete-engine's shape: a handle attached with `editor.use(engine)`, after which its calls run
  on that editor's core. Nodes already in the editor when it is attached are registered then. Before that, a call
  fails with "DataflowEngine isn't attached to NodeEditor".
- The nodes stay the app's JavaScript objects. The core calls a direct card's body in Rust (§ Direct calls) and every
  other node's own `data(inputs)` with the node as `this` through the input boundary (§ The input boundary), awaits a
  returned promise, and takes any other return as the outputs. `new DataflowEngine({ raw: true })` calls `data()` as it is, rete-engine's shape, for the engine's own tests.
  The input and output keys are the core's (§ The model), so a node that changes its sockets needs nothing
  re-registered.
- `compute(id, inputs)` runs one node of the editor as a fetch would, boundary included, without reading or filling
  its cache (a composite's simulation steps); `computeNode(node, inputs, data?)`, outside any editor, runs a node
  object through the boundary with its ports read off the object, answering at once when nothing it does waits (the
  tests drive one node this way, `tests/graph/boundaryKit.ts`).
- **Values cross by reference**: an output value is one cell in the core (`value.rs`), so it is the same object in
  every JavaScript input it reaches and in what `fetch` returns, and the same core value in every direct card's. The
  outputs object `fetch` returns is built per fetch, in the node's key order, converting what JavaScript hasn't seen;
  `fetchAll` hands `onNode` the same object it puts in its map.
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
| `pass(changed?, renderOnly?, topology)` | The app's pass body ([[compute-pass]] § The pass body): `changed` retargeted to the outermost composite holding it (each on the way marked edited), `invalidate`, the editor's cached loop set (reused by a value edit's targeted pass), seeding, `fetchAll` with stop on cancel, each node's outputs landed in the core (`landed(id, key)` reads one) and compared with what it landed before, then the nodes to re-render in the editor's order (`render_set`); `null` when a reset cancelled it. |
| `markNested(id)` | Marks every composite holding `id` as edited inside and answers the outermost one. |

## The input boundary (`boundary.rs`, `nodeBoundary.ts`)

The engine's call of every node: the error guard, the lazy frames' collect, the unit boundary, each rung's coercion and
the typed list literals on the way in; the frame format stamp and the guard's origin tagging on the way out
([[compute-pass]] § The per-node wrappers, § The error guard, § Arrival coercion, which own the behavior). Two
implementations give the same answers: `boundary_core.rs` over core values for a direct card (§ Direct calls), and
`boundary.rs` over the JavaScript values a JavaScript card takes, walked in place through `js_sys`, each array's cell
kinds read in one call (`cellKinds`) so a walk touches only the cells it changes. `cellKinds` stays while TypeScript
cards take JavaScript values: walking each cell across the boundary made a 100k list 25 ms. What only the app knows
comes from `nodeBoundary.ts` through `setBoundaryHost`, which `dataflowEngine.ts` imports, so any engine has it.

## The session (`session.rs`, `passSession.ts`)

The compute pass's state between passes: the calc mode, the dirty flag, the force-exact depth, the recalc generation,
the rebuild depth and its topology flag, the single-flight flag and the rerun a pass in flight coalesces. One per
module, as the pass is one per app. Every transition is the core's (`sessionEnter`, `sessionExit`, `sessionSetMode` and
the rest); `passSession.ts` keeps the snapshot each answers, which is what `calcModeStore`, `getRecalcGen()` and
`isGraphRebuilding()` read without crossing. The mode a browser persisted is handed over when the module loads.

## Traps

A trap anywhere in the module (a formula, a card body, the graph's own code) drops the instance. A panic runs the
module's panic hook (`setPanicHandler`) first; a trap with no panic (a stack overflow) surfaces as a
`WebAssembly.RuntimeError` at the call that crossed in. Either way (`engineWasm.ts`):

- the call that trapped throws `CoreTrap`: a formula or a card's body answers `#ERROR!` with the restart message, and
  every fetch and `fetchAll` still waiting rejects with `CoreTrap`, so a pass ends instead of waiting forever;
- once the stack has left the module (a microtask later), the instance is dropped and the compiled module
  instantiated afresh (`__wbg_reset`); the load hooks run again (`whenWasmEngineLoads`: the boundary's host, the
  session's last snapshot, the handle numbering past the dead instance's), and every live `GraphEditor` builds a new
  core from what its handle holds: its pipes and the engine in their order, then its nodes (with their ports as
  they stand) and cables, with the pipes held silent so nothing reruns a node's install or a canvas sync. The caches
  and what the core held for each card (§ Direct calls) start empty, so the next pass recomputes everything; until
  the swap a call throws `CoreTrap`, and a rerun a pass had coalesced is gone;
- a frame the verb backend held in the dead instance is gone, so a verb over it answers `#REF!` until the document
  reloads;
- what the dead instance left in JS never reaches the new one: `build-wasm.mjs` patches wasm-bindgen's glue so a
  dead instance's closure (a node's promise settling late) does nothing, its finalizers free nothing, and the object
  heap starts empty. The build fails if the glue reads differently.

`graphTrap()` and `engine_trap` are the tests' triggers (`graphTrap.test.ts`, `coreTrap.test.ts`).

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
removed. Loading personal-finance in the built app (Chromium, median of five loads): the first full pass computed in
472 ms and the cards settled in 3.3 s, against 507 ms and 3.25 s before.

Calling the cards on the core directly (2026-10-24, Node, median of 15 to 30 runs on a shared machine, before and
after on the same run): a value edit's pass, which reads no card's call again, is where it shows. A chain of 1,000
Arithmetic cards recomputed from its source took 5.3 ms against 26 (a number) and 5.9 against 39 (a 10-item list);
20 of them over a 100,000-item list 162 ms against 1,231, no list crossing between them. Personal-finance copied
eight times (1,232 nodes): one input's cone 2.1 ms against 3.8 through the app's pass. A pass that clears every
cache reads each direct card's call again, which costs about what the old crossing did: the same graph's full app
pass 81 ms against 71 by wall clock, 6.1 s against 6.3 s of CPU over 60 passes; `perfScaling.test.ts`, which also
converts every output for `fetchAll`, 81 against 69. Loading personal-finance in the built app (Chromium, median of
five loads): the first full pass computed in 501 ms against 549, the cards settled at 1.52 s against 1.53 s, every
card's text the same.

## Direct calls (phase C)

The engine calls a card's body on the core in Rust, with no JavaScript between two such cards.

- **Which cards** (`nodes::DIRECT`; `directBodies.test.ts` holds the list to the classes' source). A class whose
  `data()` is its body on the core and nothing else (`return nodeOnCore(this, inputs)`), and the classes in
  `nodes::OFF_CORE` (Display, Format Controller), whose `data()` also hands on in TypeScript what the core can't hold:
  when their pass-through input holds a LAMBDA or a value the card wire doesn't carry, their `data()` runs instead. A
  class may name a field its body sets in `static coreWatch`; when a body changes it, `coreWatched()` runs in
  TypeScript (Expression's and Series' socket retype), from `nodeOnCore` and the direct call alike. Every other card is
  called in JavaScript as before: the cards whose body is TypeScript (Note, Report, a composite, a Conduit) and the
  shells around a body on the core (an upload, a read, a draw, an alert), whose `nodeOnCore` still crosses.
- **Values live where they were made** (`value.rs`). A value on a cable is one shared cell holding the form its
  producer made, a core value (`V`, with a table's unit beside it) or a JavaScript object, and the other form once a
  reader of the other kind first asks for it, kept beside the first so every reader of that kind gets the same one.
  A direct card's inputs are core values, a JavaScript card's are objects; converting is the card wire
  (`nodeWire.ts`: `toCore`, `fromCore`), one host call per value converted, never per cell. An output that is one of
  the card's inputs as it came is that very cell. Errors keep their origin on the wire ([[E9]] errorsKeepOrigin).
- **The boundary on core values** (`boundary_core.rs`, held natively to every frozen arrival and tagging case,
  `tests/boundary_core.rs`). What only the app knows stays a host call, made only when a value needs it: a lazy
  frame's collect, a frame ref's format picks.
- **What the core keeps per card.** Its call (`coreHeader`): class, saved fields but the ones only the canvas reads (`VIEW_FIELDS`, `nodeInit.ts`: a resize, fold or recolor leaves the call as it stands, and no body on the core reads one, `namedEdits.test.ts`), literal maps, sockets, outputs,
  adopted types, the boundary's keys, its typed list literals read, which cached fields the object has, its frame
  format picks. It is read from the object on the node's first compute and again only after its node was named, its
  ports changed, it was forgotten (`forget`, a targeted `reset`, `invalidate`, a pass naming it) or it ran through
  `compute`. Clearing every cache reads nothing: the stamp stands. The text is stamped, so a read that finds what the
  core already holds sends nothing and parses nothing.
- **Every edit names its node.** An edit that changes a card in place (a field, a literal, its label) names the node
  before it asks for a pass: `processGraph(id)` names `id` before the calc-mode gate and single flight, so an edit
  manual mode holds back or a rerun coalesces is still read on F9's full pass; an edit that asks for a full pass
  calls `node.edited()` first, which tells every editor holding the node (`GraphEditor.named`, found in a
  composite's editor at any depth). What a call reads from outside the node names it where it changes: an adoptive
  socket's taken type (`AdoptiveSocket.setType`) and the frame format picks (`frameFormatStore`, through
  `nodeEdited(id)`). Enforced by `namedEdits.test.ts`: the mechanism, a sweep over all of `src/` that every full pass
  asked for follows an `edited()` (or its module names why none is needed), and the tests' audit (`auditNamedEdits`,
  `tests/setup/graphEngine.ts`): every full clear re-reads each unnamed card's call too, and a test fails whose card
  read differently. A class's `static coreFields` are read on every call. The fields a
  body sets for its component (`cachedResult` and the rest) live on the Rust node: the object reads each through an
  accessor installed the first time the body shows it (`GraphEditor.adopt`), converted when read, so a field no
  component reads never crosses ([[C120]] linearWork). Writing one from JavaScript stores it in the core; a node
  leaving the editor gets them back as plain properties holding what they showed.
- **The change test and cable values.** The core keeps each node's last landed outputs and compares there (a
  primitive by value, anything else by identity, as `!==` did); `cableValueStore` reads an output from the engine
  that ran the pass when something asks (`landed`), converting it then. The pass makes no JavaScript call per node.
- **Once per pass, not per node**: the boundary's flags (perf probe, error sinks), the clock a body reads, and the
  error sinks' reports, queued and handed over in one call when the pass or fetch ends.
- **The recorder** (`FREEZE_NODES`) turns direct calls off (`setDirectCalls`, `tests/setup/graphEngine.ts`), so it
  sees every call the suite makes through `data()`.
- **Still on the JavaScript object**: the volatile draws (`lastGen`; their shells draw and send it in `coreFields`),
  `_resolvedAngleMode` (`resolveTrigModes` walks the FC annotations in TypeScript before each pass), a composite's
  `markInternalEdit`.

## Enforcement

- `cargo test --manifest-path crates/solenoid-graph/Cargo.toml`: the walks, the model and its port sets
  (`tests/model.rs`), the session's transitions (`tests/session.rs`), the boundary on core values against the frozen
  boundary answers (`tests/boundary_core.rs`), natively.
- `namedEdits.test.ts`: a full clear keeps a card's call, naming the node reads it, an edit manual mode held back
  reaches F9, the audit catches an unnamed edit, and every full pass a component asks for names its node first.
- `directBodies.test.ts`: the direct classes are the ones whose `data()` is their body, and a direct card computes
  in an editor without its `data()` running.
- `coreBoundary.test.ts`: the input boundary's frozen answers (`fixtures/core/boundary-*`).
- `dataflowEngine.test.ts`: values by reference, errors as themselves, `Cancelled`, seeding, attaching late.
- `graphEditor.test.ts`: signal order, a cancelling pipe, a throwing pipe, removed pipes, ports and their order in
  the core, the lists.
- Ruggine's own suite and its oracle against the pinned rete-engine.
- The whole vitest suite runs on it, every seed included.
