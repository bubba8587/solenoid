// [[D102]] graphOnCore
// Nothing computes without the wasm module the graph and the cards' bodies run on, so every test file gets it, loaded
// once per module cache. While the node recorder records (`FREEZE_NODES`), every card's `data()` runs in JavaScript,
// so it sees the calls the engine would otherwise make in Rust.
import * as fs from "node:fs";
import { loadWasmEngineSync, wasmUrl, whenWasmEngineLoads } from "../../src/graph/engineWasm";
import { setDirectCalls } from "../../src/graph/engineWasm/solenoid_graph.js";

loadWasmEngineSync(fs.readFileSync(wasmUrl));
whenWasmEngineLoads(() => setDirectCalls(!process.env.FREEZE_NODES));
