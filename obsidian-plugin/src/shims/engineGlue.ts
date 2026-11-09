// [[C107]] obsidianPlugin
// The plugin's engine module (`build-wasm.mjs --plugin`): no graph engine, so `GraphCore` is never made here (the
// plugin's `activeGraph` holds no editor). The module it re-exports exists only once it is built, so the app's own
// typecheck leaves this file out (tsconfig.json `exclude`); the plugin's snapshot builds the module first.
export * from "../../../src/graph/engineWasmPlugin/solenoid_graph.js";
export { default } from "../../../src/graph/engineWasmPlugin/solenoid_graph.js";

export class GraphCore {
  constructor() {
    throw new Error("The Obsidian plugin has no graph engine");
  }
}
