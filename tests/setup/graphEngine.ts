// [[D102]] graphOnCore
// Nothing computes without the wasm module the graph and the cards' bodies run on, so every test file gets it, loaded
// once per module cache.
import * as fs from "node:fs";
import { loadWasmEngineSync, wasmUrl } from "../../src/graph/engineWasm";

loadWasmEngineSync(fs.readFileSync(wasmUrl));
