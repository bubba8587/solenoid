// [[D102]] graphOnCore
// Nothing computes without the graph engine and the core the cards' bodies run on, so every test file gets both,
// loaded once per module cache.
import * as fs from "node:fs";
import * as path from "node:path";
import { graphEngineLoaded, graphWasmUrl, loadGraphEngineSync } from "../../src/graph/graphEditor";
import { loadWasmEngineSync, wasmEngineLoaded } from "../../src/graph/engineWasm";

if (!graphEngineLoaded()) loadGraphEngineSync(fs.readFileSync(graphWasmUrl));
if (!wasmEngineLoaded()) loadWasmEngineSync(fs.readFileSync(path.resolve(__dirname, "../../src/graph/engineWasm/solenoid_core_bg.wasm")));
