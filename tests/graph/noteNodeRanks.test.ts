// [[C10]] socketLattice, [[D16]] retypeReconciles, [[C107]] obsidianPlugin
import { describe, it, expect } from "vitest";
import { NoteNode } from "../../src/graph/nodes/annotation";
import { isFrameValue } from "../../src/graph/frame";

const note = (yaml: string, fieldTypes?: ConstructorParameters<typeof NoteNode>[0] extends infer I ? I extends { fieldTypes?: infer F } ? F : never : never) =>
  new NoteNode({ body: `---\n${yaml}\n---\n`, fieldTypes });

describe("a Note's frontmatter at every rank", () => {
  it("mints a table-family socket for a matrix and a complex socket for complex text", () => {
    const n = note("grid: [[1, 2], [3, 4]]\nz: 3+4i\nzs: [3+4i, 1-2i]");
    expect(n.fieldType("grid")).toBe("table");
    expect(n.fieldType("z")).toBe("complex");
    expect(n.fieldType("zs")).toBe("complexlist");
  });

  it("reshapes a pinned element family onto the value's rank", () => {
    const n = note("grid: [[1, 2], [3, 4]]\nn: 5", { grid: "string", n: "strlist" });
    expect(n.fieldType("grid")).toBe("strtable");
    expect(n.fieldType("n")).toBe("string");
  });

  it("a date read as text is the ISO text written, never its serial; a mixed list loses nothing", () => {
    const n = note("due: 2026-09-02\nwhen: [2026-09-02]\nmixed: [1, two]", { due: "string", when: "strlist" }) as unknown as { _fieldValues: Map<string, unknown> };
    expect(n._fieldValues.get("due")).toBe("2026-09-02");
    expect(n._fieldValues.get("when")).toEqual(["2026-09-02"]);
    expect(n._fieldValues.get("mixed")).toEqual(["1", "two"]);
  });

  it("types a frame column as Date when every cell in it is a date", () => {
    const n = note("budget:\n  - item: Cabinets\n    ordered: 2026-09-02\n  - item: Tile\n    ordered: 2026-09-12") as unknown as { _fieldValues: Map<string, unknown> };
    const frame = n._fieldValues.get("budget");
    expect(isFrameValue(frame)).toBe(true);
    if (isFrameValue(frame)) expect(frame.columns.map((c) => c.type)).toEqual(["string", "date"]);
  });
});

describe("a Note's frame columns follow the plugin's picks", () => {
  const yaml = "budget:\n  - item: \"0012\"\n    ordered: 2026-09-02\n  - item: Tile\n    ordered: later";
  const frameOf = async (n: NoteNode) => { const out = await n.data(); const v = (out as Record<string, unknown>).budget; if (!isFrameValue(v)) throw new Error("not a frame"); return v; };

  it("a bare Note has no picks: a mixed column is text with its date as written", async () => {
    const fr = await frameOf(note(yaml));
    const ordered = fr.columns.find((c) => c.name === "ordered")!;
    expect(ordered.type).toBe("string");
    expect(ordered.values).toEqual(["2026-09-02", "later"]);
  });

  it("with picks, the column is the picked type through the app's boundary, the source text kept", async () => {
    const n = note(yaml);
    n.columnPicks = { budget: { ordered: "date", item: "number" } };
    n.syncFields();
    const fr = await frameOf(n);
    const ordered = fr.columns.find((c) => c.name === "ordered")!;
    expect(ordered.type).toBe("date");
    expect(typeof ordered.values[0]).toBe("number");
    expect(Number.isNaN(ordered.values[1])).toBe(true);
    expect(ordered.raw).toEqual(["2026-09-02", "later"]);
    const item = fr.columns.find((c) => c.name === "item")!;
    expect(item.type).toBe("number");
    expect(item.values[0]).toBe(12);
    expect(Number.isNaN(item.values[1])).toBe(true);
    expect(item.raw).toEqual(["0012", "Tile"]);
  });
});
