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

  it("types a frame column as Date when every cell in it is a date", () => {
    const n = note("budget:\n  - item: Cabinets\n    ordered: 2026-09-02\n  - item: Tile\n    ordered: 2026-09-12") as unknown as { _fieldValues: Map<string, unknown> };
    const frame = n._fieldValues.get("budget");
    expect(isFrameValue(frame)).toBe(true);
    if (isFrameValue(frame)) expect(frame.columns.map((c) => c.type)).toEqual(["string", "date"]);
  });
});
