import { describe, it, expect } from "vitest";
import { parseNoteFrontmatter } from "../../src/graph/noteFrontmatter";
import { NoteNode } from "../../src/graph/nodes/annotation";
import { isCubeValue, isFrameValue, recordsToCube, type CubeValue } from "../../src/graph/frame";

// A frontmatter row list whose values include a LIST is a cube (a frame cell is scalar; the
// cube exists so a list is never an in-cell string) — author, 2026-09-07.

const NOTE = [
  "---",
  "tasks:",
  "  - {task: Demolition, days: 2, after: []}",
  "  - {task: Drywall, days: 2, after: [Plumbing, Electrical]}",
  "plain:",
  "  - {name: A, n: 1}",
  "  - {name: B, n: 2}",
  "---",
  "body",
].join("\n");

describe("frontmatter rows with list values → a cube", () => {
  it("the parser keeps a flow list inside a row object as a list and guesses `cube`", () => {
    const p = parseNoteFrontmatter(NOTE);
    const tasks = p.fields.find((f) => f.key === "tasks")!;
    expect(tasks.guessed).toBe("cube");
    expect((tasks.value as Record<string, unknown>[])[1].after).toEqual(["Plumbing", "Electrical"]);
    expect(p.fields.find((f) => f.key === "plain")!.guessed).toBe("frame");
  });
  it("the Note emits a cube socket for it (list cells intact) and a frame for scalar rows", () => {
    const n = new NoteNode({ body: NOTE });
    expect(n.fieldType("tasks")).toBe("cube");
    expect(n.fieldType("plain")).toBe("frame");
    const v = n.fieldValues().tasks as CubeValue;
    expect(isCubeValue(v)).toBe(true);
    expect(v.columns.map((c) => c.name)).toEqual(["task", "days", "after"]);
    expect(v.columns[2].cells).toEqual([[], ["Plumbing", "Electrical"]]);
    expect(v.columns[1].type).toBe("number");
    expect(isFrameValue(n.fieldValues().plain)).toBe(true);
  });
  it("recordsToCube: scalar columns typed, list values list cells, nested records a nested cube", () => {
    const c = recordsToCube([{ a: 1, tags: ["x"], sub: [{ k: 1 }] }, { a: 2, tags: [], sub: [] }]);
    expect(c.columns.map((x) => x.name)).toEqual(["a", "tags", "sub"]);
    expect(c.columns[0].type).toBe("number");
    expect(c.columns[1].cells).toEqual([["x"], []]);
    expect(isCubeValue(c.columns[2].cells[0])).toBe(true);
  });
});

describe("review pins: recordsToCube", () => {
  it("a null beside records is an empty row of the nested cube, not a list of cubes", () => {
    const c = recordsToCube([{ steps: [{ a: 1 }, null] }]);
    const cell = c.columns[0].cells[0];
    expect(isCubeValue(cell)).toBe(true);
    expect(isCubeValue(cell) && cell.columns[0].cells).toEqual([1, null]);
  });
});
