// [[D102]] graphOnCore
// Nothing computes without the graph engine, so every test file gets it, loaded once per module cache.
import * as fs from "node:fs";
import * as path from "node:path";
import { graphEngineLoaded, loadGraphEngineSync } from "../../src/graph/dataflowEngine";

if (!graphEngineLoaded()) {
  loadGraphEngineSync(fs.readFileSync(path.resolve(__dirname, "../../src/graph/graphWasm/solenoid_graph_bg.wasm")));
}
