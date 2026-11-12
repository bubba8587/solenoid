// [[C17]] shareImpl, [[obsidian-plugin]], [[obsidian-plugin#Requirements]]
import { describe, it, expect } from "vitest";
import { cellToYaml, frameSourceFromYaml, listToYaml, coerceYaml, validateYaml, PROPERTY_KINDS } from "../../obsidian-plugin/src/yamlValue";
import { parseNoteFrontmatter } from "../../src/graph/noteFrontmatter";

describe("the plugin reads and writes note dates as the app does", () => {
  it("guesses a date column only for text the app reads as a date", () => {
    const pluginType = (v: string) => frameSourceFromYaml([{ d: v }])[0].type;
    expect(pluginType("2024-03-05")).toBe("date");
    expect(pluginType("2024-03-05T10:30")).toBe("date");
    expect(pluginType("2024-03-05 is a Tuesday")).toBe("string");
    expect(pluginType("2024-03-05T10:30:00Z")).toBe("string");
    for (const text of ["2024-03-05", "2024-03-05T10:30", "2024-03-05 is a Tuesday", "2024-03-05T10:30:00Z"]) {
      const app = parseNoteFrontmatter(`---\nt:\n  - d: ${text}\n---\n`).fields[0];
      expect(app.dateColumns?.includes("d") ?? false).toBe(pluginType(text) === "date");
    }
  });

  it("types a frame column as the app does: one family throughout, else text", async () => {
    const { NoteNode } = await import("../../src/graph/nodes/annotation");
    const cases: [string, string][] = [["1", "number"], ["true", "logical"], ["x", "string"]];
    for (const [a, aType] of cases) for (const [b, bType] of cases) {
      const note = new NoteNode({ body: `---\nt:\n  - c: ${a}\n  - c: ${b}\n---\n` });
      note.syncFields();
      const appType = (note.fieldValues().t as { columns: { type: string }[] }).columns[0].type;
      const pluginType = frameSourceFromYaml([{ c: JSON.parse(a === "x" ? '"x"' : a) }, { c: JSON.parse(b === "x" ? '"x"' : b) }])[0].type;
      expect(appType).toBe(pluginType);
      expect(appType).toBe(aType === bType ? aType : "string");
    }
  });

  it("keeps a date's time when it writes a cell", () => {
    expect(cellToYaml("2024-03-05", "date")).toBe("2024-03-05");
    expect(cellToYaml("2024-03-05T10:30", "date")).toBe("2024-03-05T10:30:00");
  });
});

describe("the plugin writes a real Complex value as a number", () => {
  it("a Complex property typed 5 is written as the number 5 and a list keeps its family", () => {
    expect(cellToYaml("5", "complex")).toBe(5);
    expect(cellToYaml("3+4i", "complex")).toBe("3+4i");
    expect(cellToYaml("nope", "complex")).toBe(null);
    const list = listToYaml([["3+4i"], ["5"]], [], "complex");
    expect(list).toEqual(["3+4i", 5]);
    const yaml = `---\nk:\n${list.map((v) => `  - ${v}`).join("\n")}\n---\n`;
    expect(parseNoteFrontmatter(yaml).fields[0].guessed).toBe("complexlist");
  });
});

describe("a type switched in Obsidian's Update dialog keeps every value ([[obsidian-plugin#Requirements]])", () => {
  const kind = (id: string) => PROPERTY_KINDS.find((k) => k.id === id)!;
  const cube = [{ name: "a", tags: ["x", "y"], sub: [{ q: 1 }] }, { name: "b", tags: [], sub: null }];

  it("a cube read as a list or a frame keeps its nested values as their text", () => {
    const list = coerceYaml(kind("solenoid-strlist"), cube);
    expect(list).toEqual(["a", '["x","y"]', '[{"q":1}]', "b", "[]", null]);
    const frame = coerceYaml(kind("solenoid-frame"), cube);
    expect(frame).toEqual([{ name: "a", tags: '["x","y"]', sub: '[{"q":1}]' }, { name: "b", tags: "[]", sub: null }]);
    expect(validateYaml(kind("solenoid-frame"), frame)).toBe(true);
  });

  it("a matrix row holding a list keeps it as text", () => {
    expect(coerceYaml(kind("solenoid-list"), [[1, [2, 3]], [4]])).toEqual([1, "[2,3]", 4]);
    expect(coerceYaml(kind("solenoid-frame"), [[1, { a: 2 }]])).toEqual([{ Col1: 1, Col2: '{"a":2}' }]);
  });

  it("a value that already fits is untouched", () => {
    expect(coerceYaml(kind("solenoid-cube"), cube)).toBe(cube);
  });
});
