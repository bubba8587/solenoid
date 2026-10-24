// [[D102]] graphOnCore
// Nothing computes without the wasm module the graph and the cards' bodies run on, so every test file gets it, loaded
// once per module cache. While the node recorder records (`FREEZE_NODES`), every card's `data()` runs in JavaScript,
// so it sees the calls the engine would otherwise make in Rust. A test fails that changes a direct card in place
// without naming its node (graph-core.md § Direct calls); a benchmark (`PERF`) runs without that check.
import * as fs from "node:fs";
import { afterEach } from "vitest";
import { loadWasmEngineSync, wasmUrl, whenWasmEngineLoads } from "../../src/graph/engineWasm";
import { auditNamedEdits, setDirectCalls, unnamedEdits } from "../../src/graph/engineWasm/solenoid_graph.js";

loadWasmEngineSync(fs.readFileSync(wasmUrl));
whenWasmEngineLoads(() => {
  setDirectCalls(!process.env.FREEZE_NODES);
  auditNamedEdits(!process.env.PERF);
});

afterEach(() => {
  const caught = unnamedEdits();
  if (caught.length) throw new Error(`changed in place with its node unnamed (node.edited(), or name it to the pass): ${[...new Set(caught)].join(", ")}`);
});
