---
aliases: ["Graph core"]
tags: [spec, computation]
---
<!-- [[D102]] graphOnCore, [[C130]] rustCore, [[C23]] calcModes -->

# Spec: the graph core

Serves [[D102]] graphOnCore and [[C130]] rustCore. The dataflow engine and the compute pass's graph walks run in
Rust: `crates/solenoid-graph`, built on [Ruggine](https://github.com/bubba8587/ruggine), the Rust port of rete and
rete-engine kept as its own library. What the pass does with them is [[compute-pass]]; this file owns how the engine
is hosted.

## The module

- **Its own WebAssembly module**, `src/graph/graphWasm/`, apart from the formula core's `engineWasm/`. The formula
  core is dropped and instantiated afresh after a trap ([[rust-core]] § Where it runs), and a node's formula call runs
  while the graph's own frames are on the stack; one instance would lose the graph to any trapping formula.
- **Built** by `npm run build:wasm` (`node scripts/build-wasm.mjs graph` for this one), with wasm-bindgen's weak
  refs, and stamped like the core (`source-stamp.txt`, `wasmStamp.test.ts`).
- **Ruggine is pinned** by git revision in `crates/solenoid-graph/Cargo.toml`. Moving the pin: change the `rev`, run
  `cargo test --manifest-path crates/solenoid-graph/Cargo.toml`, rebuild, run the suite.
- **Required.** Nothing computes without it, so there is no TypeScript fallback and no setting turns it off. The
  app's first render waits for `loadGraphEngine()` with no deadline (`main.tsx`); creating an engine before it loads
  throws. Tests load it in `tests/setup/graphEngine.ts`; a Node script calls `loadGraphEngineSync` with the bytes
  (`scripts/run-graph.ts`).

## The engine (`dataflowEngine.ts`, `wasm.rs`)

- `DataflowEngine` keeps rete-engine's shape: a plugin attached with `editor.use(engine)` under the rete
  `NodeEditor`, which is still the model. It mirrors the editor into a Ruggine `NodeEditor` on `nodecreated`,
  `noderemoved`, `connectioncreated` and `connectionremoved`, and on attaching copies whatever the editor already
  holds. No code edits a connection in place, so the mirror needs nothing else.
- The nodes stay the app's JavaScript objects. The core calls `node.data(inputs)` with the node as `this`, awaits a
  returned promise, and takes any other return as the outputs. A node's input and output keys are read from
  `Object.keys(node.inputs)` and `Object.keys(node.outputs)` at every fetch, so a node that changes its sockets needs
  nothing re-registered.
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

The engine answers the walks over the graph it mirrors; `graphCompute.ts` reaches them for an editor through
`engineOf(editor)`:

| Call | Behavior |
|---|---|
| `loopMembers()` | Self-cabled nodes in cable order, then each strongly connected component of two or more, as an iterative Tarjan walk closes it. A cable to a node not in the editor is ignored. |
| `downstreamClosure(id)` | `id` and every node its cables reach, breadth first, each once. |
| `invalidate(id, keepCaches)` | With a node: clears its cone's caches and returns the cone. Without one: `reset()` unless `keepCaches`, and `null`. |
| `fetchAll(onNode?, stopOnCancel)` | Fetches every node in the editor's order, skipping one removed mid-pass; a cancelled fetch records `null`, or with `stopOnCancel` ends the pass with `null`; any other rejection rejects the pass. |

## Limits

- A trap inside this module (a panic is one) isn't recovered: its engines are gone until the page reloads. What
  would change it: rebuilding each live engine's mirror from its editor after reinstantiating, as the core recovers.
- `scripts/run-graph.ts` under plain `tsx` can't import either module's `?url` wasm import (it fails on the formula
  core's first); it runs under vitest (`run-graph-vault.test.ts`).

## Performance

`PERF=1 npx vitest run tests/graph/perfScaling.test.ts`: the personal-finance seed copied 2 to 8 times, a full
reset and a fetch of every node, median of 30, Node, measured 2026-10-22 against rete-engine 2.1.0 on the same
machine. Node `data()` work is in both columns; rete-engine's per-node cost stayed flat while the core's fell.

| nodes | rete-engine ms | graph core ms |
| ---: | ---: | ---: |
| 308 | 18.5 | 13.4 |
| 616 | 38.2 | 23.5 |
| 1232 | 88.3 | 39.5 |

## Enforcement

- `cargo test --manifest-path crates/solenoid-graph/Cargo.toml`: the walks, natively.
- `dataflowEngine.test.ts`: values by reference, errors as themselves, `Cancelled`, seeding, the mirror.
- Ruggine's own suite and its oracle against the pinned rete-engine.
- The whole vitest suite runs on it, every seed included.
