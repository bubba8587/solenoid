// [[C107]] obsidianPlugin, [[C67]] mdbaseCeiling
import { describe, it, expect } from "vitest";
import { parsePluginColumnTypes, PLUGIN_DATA_PATH } from "../../src/graph/pluginColumnTypes";

describe("the plugin's picked column types", () => {
  it("reads columnTypes, property then column, keeping only real types", () => {
    const text = JSON.stringify({ palette: "Orchard", look: true, columnTypes: { budget: { item: "string", cost: "number", ordered: "date", paid: "logical", odd: "frame" }, junk: "no", empty: {} } });
    expect(parsePluginColumnTypes(text)).toEqual({ budget: { item: "string", cost: "number", ordered: "date", paid: "logical" } });
  });

  it("is empty for a malformed or pick-less file", () => {
    expect(parsePluginColumnTypes("{")).toEqual({});
    expect(parsePluginColumnTypes(JSON.stringify({ look: true }))).toEqual({});
    expect(parsePluginColumnTypes(JSON.stringify({ columnTypes: [] }))).toEqual({});
  });

  it("lives where the plugin keeps its data", () => {
    expect(PLUGIN_DATA_PATH).toBe(".obsidian/plugins/solenoid-properties/data.json");
  });
});
