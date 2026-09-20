// [[C107]] obsidianPlugin
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseNoteFrontmatter } from "../../src/graph/noteFrontmatter";
import {
  PROPERTY_KINDS, validateYaml, listFromYaml, matrixFromYaml, listToYaml, matrixToYaml,
  frameSourceFromYaml, frameSourceToYaml, type PropertyKind,
} from "../../obsidian-plugin/src/yamlValue";
import { SOCKET_COLORS } from "../../src/graph/sockets";

const kind = (id: string): PropertyKind => PROPERTY_KINDS.find((k) => k.id === id)!;

describe("the plugin's property kinds", () => {
  it("names each kind after the socket variant it holds", () => {
    expect(PROPERTY_KINDS).toHaveLength(12);
    for (const k of PROPERTY_KINDS) {
      expect(Object.keys(SOCKET_COLORS)).toContain(k.id.replace(/^solenoid-/, ""));
    }
  });

  it("validates by shape, and by family inside a list or matrix", () => {
    expect(validateYaml(kind("solenoid-list"), [1, null, 2.5])).toBe(true);
    expect(validateYaml(kind("solenoid-list"), [1, "two"])).toBe(false);
    expect(validateYaml(kind("solenoid-list"), [[1, 2]])).toBe(false);
    expect(validateYaml(kind("solenoid-datelist"), ["2026-09-01"])).toBe(true);
    expect(validateYaml(kind("solenoid-datelist"), ["next week"])).toBe(false);
    expect(validateYaml(kind("solenoid-complexlist"), ["3+4i", 2])).toBe(true);
    expect(validateYaml(kind("solenoid-table"), [[1, 2], [3, 4]])).toBe(true);
    expect(validateYaml(kind("solenoid-table"), [1, 2])).toBe(false);
    expect(validateYaml(kind("solenoid-frame"), [{ a: 1, b: "x" }])).toBe(true);
    expect(validateYaml(kind("solenoid-frame"), [{ a: [1, 2] }])).toBe(false);
    expect(validateYaml(kind("solenoid-cube"), [{ a: [1, 2], b: [{ c: 1 }] }])).toBe(true);
    expect(validateYaml(kind("solenoid-cube"), "text")).toBe(false);
  });
});

describe("a property's YAML survives the editor untouched", () => {
  it("round-trips a list of every family", () => {
    const back = (yaml: unknown[], family: Parameters<typeof listToYaml>[1]) =>
      listToYaml(yaml.map((v) => [v === null ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v)]), family);
    expect(back([12.5, null, 14], "number")).toEqual([12.5, null, 14]);
    expect(back(["Ana", "Ben"], "string")).toEqual(["Ana", "Ben"]);
    expect(back(["2026-09-01", "2026-10-15"], "date")).toEqual(["2026-09-01", "2026-10-15"]);
    expect(back([true, false], "logical")).toEqual([true, false]);
    expect(back(["3+4i", "1-2i"], "complex")).toEqual(["3+4i", "1-2i"]);
  });

  it("hands the chip serials for a date list, and pads a ragged matrix", () => {
    const [a, b] = listFromYaml(["2026-09-01", "2026-09-02"], "date") as number[];
    expect(b - a).toBe(1);
    expect(matrixFromYaml([[1, 2, 3], [4]], "number")).toEqual([[1, 2, 3], [4, null, null]]);
    expect(matrixToYaml([["1", ""], ["x", "4"]], "number")).toEqual([[1, null], [null, 4]]);
  });

  it("types a frame's columns from the YAML and writes the same rows back", () => {
    const rows = [
      { item: "Cabinets", cost: 4200, ordered: "2026-09-02", paid: true },
      { item: "Tile", cost: 880, ordered: "2026-09-12", paid: false },
    ];
    const source = frameSourceFromYaml(rows);
    expect(source.map((c) => c.type)).toEqual(["string", "number", "date", "logical"]);
    expect(frameSourceToYaml(source)).toEqual(rows);
  });

  it("keeps every key on every row, a missing cell as null", () => {
    const source = frameSourceFromYaml([{ a: 1 }, { a: 2, b: "x" }]);
    expect(frameSourceToYaml(source)).toEqual([{ a: 1, b: null }, { a: 2, b: "x" }]);
  });
});

describe("the demo note", () => {
  const text = readFileSync("demo-vault/Solenoid/Property types.md", "utf8");
  const fields = Object.fromEntries(parseNoteFrontmatter(text).fields.map((f) => [f.key, f.guessed]));

  it("reads in Solenoid as the types the plugin shows", () => {
    expect(fields).toMatchObject({
      readings: "list", crew: "strlist", signed_off: "logicallist", budget: "frame", phases: "cube",
    });
  });
});
