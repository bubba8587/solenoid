// [[obsidian-plugin]]
// The plugin's engine module (`build-wasm.mjs --plugin`): no graph engine, so `GraphCore` is never made here (the
// plugin's `activeGraph` holds no editor), and none of the exports only the app's graph calls (binary sources, Excel
// workbooks, the card stash, field contracts, chart regions), which the `plugin` feature leaves out of the module so
// what they reach is linked out too. Each stands here as a function that throws. The module it re-exports exists only
// once it is built, so the app's own typecheck leaves this file out (tsconfig.json `exclude`); the plugin's snapshot
// builds the module first.
export * from "../../../src/graph/engineWasmPlugin/solenoid_graph.js";
export { default } from "../../../src/graph/engineWasmPlugin/solenoid_graph.js";

export class GraphCore {
  constructor() {
    throw new Error("The Obsidian plugin has no graph engine");
  }
}

const absent = (name: string) => (): never => {
  throw new Error(`The Obsidian plugin's engine has no ${name}`);
};
export const engine_source_bin = absent("engine_source_bin");
export const engine_read_bin = absent("engine_read_bin");
export const engine_csv_frame = absent("engine_csv_frame");
export const engine_xlsx_tables = absent("engine_xlsx_tables");
export const engine_xlsx_frame = absent("engine_xlsx_frame");
export const card_unstage = absent("card_unstage");
export const card_keep = absent("card_keep");
export const card_forget = absent("card_forget");
export const card_kept_count = absent("card_kept_count");
export const literal_field = absent("literal_field");
export const empty_field = absent("empty_field");
export const read_date = absent("read_date");
export const region_keys = absent("region_keys");
