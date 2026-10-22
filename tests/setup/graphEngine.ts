// [[D102]] graphOnCore
// Nothing computes without the graph engine, so every test file gets it, loaded once per module cache.
import * as fs from "node:fs";
import { graphEngineLoaded, graphWasmUrl, loadGraphEngineSync } from "../../src/graph/dataflowEngine";

if (!graphEngineLoaded()) loadGraphEngineSync(fs.readFileSync(graphWasmUrl));
