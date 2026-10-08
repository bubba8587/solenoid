// [[C107]] obsidianPlugin, [[C67]] mdbaseCeiling, [[D90]] cubeTypesAtDepth
import { describe, it, expect } from "vitest";
import { parsePluginColumnTypes, parsePluginNestedTables } from "../../src/graph/pluginColumnTypes";
import { PLUGIN_DATA_PATH } from "../../src/graph/pluginDataPath";

describe("the plugin's picked column types", () => {
  it("reads columnTypes, property then column, keeping only real types", () => {
    const text = JSON.stringify({ palette: "Orchard", look: true, columnTypes: { budget: { item: "string", cost: "number", ordered: "date", paid: "logical", odd: "frame" }, junk: "no", empty: {} } });
    expect(parsePluginColumnTypes(text)).toEqual({ budget: { item: "string", cost: "number", ordered: "date", paid: "logical" } });
  });

  it("reads each note's nested-table picks, per property, per records path", () => {
    const text = JSON.stringify({ nestedTables: { "Log/Mon.md": { tasks: { '[0,"items"]': { frame: true, types: { hours: "number", odd: "frame" } } }, junk: 3 }, bad: [] } });
    expect(parsePluginNestedTables(text)).toEqual({ "Log/Mon.md": { tasks: { '[0,"items"]': { frame: true, types: { hours: "number" } } } } });
    expect(parsePluginNestedTables("{")).toEqual({});
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
