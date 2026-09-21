// [[C107]] obsidianPlugin
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseNoteFrontmatter } from "../../src/graph/noteFrontmatter";
import { parseObsidianTypes } from "../../src/graph/obsidianTypes";
import {
  PROPERTY_KINDS, validateYaml, coerceYaml, listFromYaml, matrixFromYaml, listToYaml, matrixToYaml, frameSourceFromYaml, frameSourceToYaml, type PropertyKind, columnTypesOf, readColumnTypes, scalarText,
} from "../../obsidian-plugin/src/yamlValue";
import { SOCKET_COLORS } from "../../src/graph/sockets";

const kind = (id: string): PropertyKind => PROPERTY_KINDS.find((k) => k.id === id)!;

describe("the plugin's property kinds", () => {
  it("names each kind after the socket variant it holds", () => {
    expect(PROPERTY_KINDS).toHaveLength(13);
    for (const k of PROPERTY_KINDS) {
      expect(Object.keys(SOCKET_COLORS)).toContain(k.id.replace(/^solenoid-/, ""));
    }
  });

  it("takes a complex scalar as text or a number, and refuses the rest", () => {
    const complex = kind("solenoid-complex");
    for (const ok of ["3+4i", "-2i", 5, null, ""]) expect(validateYaml(complex, ok), String(ok)).toBe(true);
    for (const bad of ["three", true, [1, 2], { re: 1 }]) expect(validateYaml(complex, bad), JSON.stringify(bad)).toBe(false);
    // After a type switch the field opens on the first cell that reads.
    expect(scalarText(complex, ["1-2i", "3+4i"])).toBe("1-2i");
    expect(scalarText(complex, "3+4i")).toBe("3+4i");
    expect(scalarText(complex, { a: "nope" })).toBe("");
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

  it("opens a column as the type the user picked, whatever its cells look like", () => {
    const rows = [{ sku: "0012", due: "2026-10-01" }, { sku: "0450", due: "2026-10-04" }];
    const source = frameSourceFromYaml(rows, { sku: "string", due: "string" });
    expect(source.map((c) => c.type)).toEqual(["string", "string"]);
    expect(frameSourceToYaml(source)).toEqual(rows);
  });

  it("guesses an untyped column from the YAML values' own types, never their text", () => {
    // A quoted "0012" is Text: guessed as Number, a Save would write 12 and lose the zeros.
    const rows = [{ sku: "0012", qty: 3, ok: true, due: "2026-10-01", blank: null }];
    const source = frameSourceFromYaml(rows);
    expect(source.map((c) => c.type)).toEqual(["string", "number", "logical", "date", "string"]);
    expect(frameSourceToYaml(source)).toEqual(rows);
    expect(frameSourceFromYaml([{ mixed: 1 }, { mixed: "two" }])[0].type).toBe("string");
  });

  it("reports every written column's type on Save, under the name it was written as", () => {
    const source = frameSourceFromYaml([{ a: 1 }], { a: "string" });
    source.push({ name: "", type: "date", cells: ["2026-10-01"] });
    expect(columnTypesOf(source)).toEqual({ a: "string", Col2: "date" });
  });

  it("reads back only real column types from data.json", () => {
    expect(readColumnTypes({ budget: { cost: "number", item: "chip", n: 3 }, junk: "x" })).toEqual({ budget: { cost: "number" } });
    expect(readColumnTypes(undefined)).toEqual({});
  });

  it("keeps every key on every row, a missing cell as null", () => {
    const source = frameSourceFromYaml([{ a: 1 }, { a: 2, b: "x" }]);
    expect(frameSourceToYaml(source)).toEqual([{ a: 1, b: null }, { a: 2, b: "x" }]);
  });
});

describe("a value left behind by a type switch", () => {
  const frame = [{ item: "Cabinets", cost: 4200 }, { item: "Tile", cost: 880 }];

  it("comes back untouched when it already fits", () => {
    expect(coerceYaml(kind("solenoid-frame"), frame)).toBe(frame);
  });

  it("is empty for null, an empty string and Obsidian's []", () => {
    // A container is an empty list; the one scalar is missing.
    for (const k of PROPERTY_KINDS) for (const v of [null, undefined, "", []]) expect(coerceYaml(k, v)).toEqual(k.shape === "scalar" ? null : []);
  });

  it("widens as the socket boundary does", () => {
    expect(coerceYaml(kind("solenoid-strlist"), "hello")).toEqual(["hello"]);
    expect(coerceYaml(kind("solenoid-table"), [1, 2, 3])).toEqual([[1, 2, 3]]);
    expect(coerceYaml(kind("solenoid-frame"), ["a", "b"])).toEqual([{ Col1: "a", Col2: "b" }]);
    expect(coerceYaml(kind("solenoid-frame"), [[1, 2], [3, 4]])).toEqual([{ Col1: 1, Col2: 2 }, { Col1: 3, Col2: 4 }]);
    expect(coerceYaml(kind("solenoid-cube"), "hello")).toEqual([{ Col1: "hello" }]);
    expect(coerceYaml(kind("solenoid-cube"), frame)).toBe(frame);
  });

  it("narrows to what the kind can hold, a cell it cannot read as missing", () => {
    expect(coerceYaml(kind("solenoid-strlist"), frame)).toEqual(["Cabinets", "4200", "Tile", "880"]);
    expect(coerceYaml(kind("solenoid-list"), frame)).toEqual([null, 4200, null, 880]);
    expect(coerceYaml(kind("solenoid-list"), ["12", "x"])).toEqual([12, null]);
    expect(coerceYaml(kind("solenoid-table"), frame)).toEqual([[null, 4200], [null, 880]]);
    expect(coerceYaml(kind("solenoid-frame"), [{ a: 1, b: [1, 2] }])).toEqual([{ a: 1, b: null }]);
  });

  it("always yields a value the kind validates", () => {
    const leftovers = ["hello", 42, true, [1, 2], ["a"], [[1], [2]], frame, [{ a: [1], b: [{ c: 1 }] }], { lone: "map" }];
    for (const k of PROPERTY_KINDS) for (const v of leftovers) expect(validateYaml(k, coerceYaml(k, v)), `${k.id} ← ${JSON.stringify(v)}`).toBe(true);
  });
});

describe("blank rows at the end are the editor's, never the note's", () => {
  it("drops them on save and keeps a blank in the middle", () => {
    expect(listToYaml([["1"], [""], ["3"], [""], [""]], "number")).toEqual([1, null, 3]);
    expect(listToYaml([[""]], "string")).toEqual([]);
    expect(matrixToYaml([["1", "2"], ["", ""]], "number")).toEqual([[1, 2]]);
    expect(frameSourceToYaml([{ name: "", type: "string", cells: ["x", ""] }])).toEqual([{ Col1: "x" }]);
    expect(frameSourceToYaml([{ name: "", type: "string", cells: [""] }])).toEqual([]);
  });
});

describe("the demo note", () => {
  const text = readFileSync("demo-vault/Solenoid/Property types.md", "utf8");
  const fields = Object.fromEntries(parseNoteFrontmatter(text).fields.map((f) => [f.key, f.guessed]));

  it("reads in Solenoid as the types the plugin shows", () => {
    expect(fields).toMatchObject({
      readings: "list", crew: "strlist", milestones: "datelist", signed_off: "logicallist", impedance: "complexlist",
      grid: "table", budget: "frame", phases: "cube",
    });
  });

  it("types.json names a plugin type Solenoid's vault reader understands", () => {
    const hints = parseObsidianTypes(readFileSync("demo-vault/.obsidian/types.json", "utf8"));
    expect(hints).toMatchObject({
      readings: { kind: "list", elem: "number" },
      crew: { kind: "list", elem: "string" },
      milestones: { kind: "list", elem: "date" },
      signed_off: { kind: "list", elem: "logical" },
      grid: { kind: "matrix", elem: "number" },
      budget: { kind: "frame" },
      // Rows of records either way; a list cell is what makes it a cube.
      phases: { kind: "frame" },
    });
  });
});
