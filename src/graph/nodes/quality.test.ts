import { describe, it, expect } from "vitest";
import { ExpectNode } from "./quality";
import { solError } from "../errorValue";
import type { FrameValue, FrameCell, FrameColType } from "../frame";

// Expect checks over FRAMES (the audit-found blind spot: a FrameValue fell into
// the scalar arm and every check silently no-opped) + the pre-existing
// list/scalar behavior, pinned so it can't regress.

const frame = (cols: [string, FrameColType, FrameCell[]][]): FrameValue => ({
  __frame: true,
  columns: cols.map(([name, type, values]) => ({ name, type, values })),
});

function run(node: ExpectNode, value: unknown) {
  node.data({ in: [value] });
  return node.violations;
}

describe("Expect over frames", () => {
  it("notNull flags a null cell anywhere in the table", () => {
    const n = new ExpectNode({ checkNotNull: true });
    expect(run(n, frame([["a", "number", [1, 2]], ["b", "string", ["x", null]]]))).toEqual(["notNull"]);
    expect(run(n, frame([["a", "number", [1, 2]], ["b", "string", ["x", "y"]]]))).toEqual([]);
  });

  it("unique means unique ROWS for a frame", () => {
    const n = new ExpectNode({ checkNotNull: false, checkUnique: true });
    const dup = frame([["a", "number", [1, 2, 1]], ["b", "string", ["x", "y", "x"]]]);
    expect(run(n, dup)).toEqual(["unique"]);
    // Same cell values across DIFFERENT columns is not a duplicate row.
    const ok = frame([["a", "number", [1, 2]], ["b", "number", [2, 1]]]);
    expect(run(n, ok)).toEqual([]);
  });

  it("range and regex scan every cell", () => {
    const n = new ExpectNode({ checkNotNull: false, checkRange: true, checkRegex: true });
    n.literals.min = 0;
    n.literals.max = 10;
    n.stringLiterals.pattern = "^[a-z]+$";
    const bad = frame([["a", "number", [5, 99]], ["b", "string", ["ok", "NOT OK"]]]);
    expect(run(n, bad)).toEqual(["range", "regex"]);
    const good = frame([["a", "number", [5, 9]], ["b", "string", ["ok", "fine"]]]);
    expect(run(n, good)).toEqual([]);
  });

  it("notNull flags a per-cell error (a #DIV/0! cell isn't valid present data)", () => {
    const n = new ExpectNode({ checkNotNull: true });
    const err = solError("#DIV/0!", "divide by zero") as unknown as FrameCell;
    expect(run(n, frame([["a", "number", [1, err]], ["b", "string", ["x", "y"]]]))).toEqual(["notNull"]);
    // A list with an errored element too.
    expect(run(n, [1, solError("#N/A", "not available"), 3])).toEqual(["notNull"]);
  });

  it("passes the frame through unchanged", () => {
    const n = new ExpectNode({ checkNotNull: true });
    const f = frame([["a", "number", [1, null]]]);
    expect(n.data({ in: [f] }).out).toBe(f);
  });
});

describe("Expect over lists/scalars (unchanged behavior)", () => {
  it("unique still works on a plain list", () => {
    const n = new ExpectNode({ checkNotNull: false, checkUnique: true });
    expect(run(n, [1, 2, 2])).toEqual(["unique"]);
    expect(run(n, [1, 2, 3])).toEqual([]);
  });

  it("notNull on a scalar null", () => {
    const n = new ExpectNode({ checkNotNull: true });
    expect(run(n, null)).toEqual(["notNull"]);
    expect(run(n, 5)).toEqual([]);
  });
});
