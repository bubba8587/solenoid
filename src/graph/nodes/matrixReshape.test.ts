import { describe, it, expect } from "vitest";
import { isSolError } from "../errorValue";
import { TableTransposeNode, HStackTableNode, TableReshapeNode, TableSelectNode, TableTakeDropNode, ExpandNode, TableInfoNode, TableMultNode, MatDetNode, parseTableText } from "./matrix";
import { SolenoidSocket, type SocketDataType } from "../sockets";

// The pure-reshape matrix ops are element-agnostic: they accept any matrix on an
// `any` input and emit the 2-D wildcard `anytable` (or a 1-D `any` list when
// flattening), so text / date matrices flow through them — not just numbers.

const dt = (s: unknown): SocketDataType | undefined =>
  s instanceof SolenoidSocket ? s.dataType : undefined;

describe("reshapers are element-polymorphic", () => {
  it("TRANSPOSE flips a text matrix and outputs `anytable`", () => {
    const n = new TableTransposeNode();
    expect(dt(n.outputs.result?.socket)).toBe("anytable");
    // The 2-D input is the grid wildcard too (a 1-D list widens in); see sockets.ts.
    expect(dt(n.inputs.matrix?.socket)).toBe("anytable");
    expect(n.data({ matrix: [[["a", "b"], ["c", "d"]]] }).result).toEqual([
      ["a", "c"],
      ["b", "d"],
    ]);
  });

  it("TRANSPOSE still works on numbers (no regression)", () => {
    const n = new TableTransposeNode();
    expect(n.data({ matrix: [[[1, 2], [3, 4]]] }).result).toEqual([[1, 3], [2, 4]]);
  });

  it("TOCOL flattens a text matrix to a 1-D list (the MAP→column link)", () => {
    const n = new TableReshapeNode({ op: "tocol" });
    expect(dt(n.outputs.result?.socket)).toBe("any"); // 1-D, untyped element
    expect(n.data({ matrix: [[["Jo"], ["Di"]]] }).result).toEqual(["Jo", "Di"]);
  });

  it("WRAPROWS builds a text matrix from a text list", () => {
    const n = new TableReshapeNode({ op: "wraprows" });
    expect(dt(n.outputs.result?.socket)).toBe("anytable");
    expect(n.data({ list: [["a", "b", "c", "d"]], wrapCount: [2] }).result).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("WRAPROWS/WRAPCOLS pad the leftover cells with #N/A (Excel default)", () => {
    const rows = new TableReshapeNode({ op: "wraprows" })
      .data({ list: [["a", "b", "c", "d", "e"]], wrapCount: [3] }).result as unknown[][];
    expect(rows[0]).toEqual(["a", "b", "c"]);
    expect(rows[1].slice(0, 2)).toEqual(["d", "e"]);
    expect(isSolError(rows[1][2])).toBe(true);
    const cols = new TableReshapeNode({ op: "wrapcols" })
      .data({ list: [[1, 2, 3]], wrapCount: [2] }).result as unknown[][];
    expect(cols[0]).toEqual([1, 3]);
    expect(cols[1][0]).toBe(2);
    expect(isSolError(cols[1][1])).toBe(true);
  });

  it("HSTACK stitches two text matrices side by side", () => {
    const n = new HStackTableNode();
    expect(n.data({ t0: [[["a"], ["b"]]], t1: [[["x"], ["y"]]] }).result).toEqual([
      ["a", "x"],
      ["b", "y"],
    ]);
  });

  it("TAKE/DROP (table) cut both axes; negative counts work from the end", () => {
    const m = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    expect(new TableTakeDropNode({ op: "take" }).data({ matrix: [m], rows: [2] }).result)
      .toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(new TableTakeDropNode({ op: "take" }).data({ matrix: [m], rows: [-1], cols: [-2] }).result)
      .toEqual([[8, 9]]);
    expect(new TableTakeDropNode({ op: "take" }).data({ matrix: [m], rows: [99] }).result)
      .toEqual(m); // past the size keeps everything, like Excel
    expect(new TableTakeDropNode({ op: "drop" }).data({ matrix: [m], rows: [1], cols: [-1] }).result)
      .toEqual([[4, 5], [7, 8]]);
    // TAKE cols on a bare list (one row) — the 2-D spelling of "first 2 elements"
    expect(new TableTakeDropNode({ op: "take" }).data({ matrix: [[9, 8, 7]], cols: [2] }).result)
      .toEqual([[9, 8]]);
  });

  it("EXPAND grows with the fill (or #N/A); shrinking is #VALUE!", () => {
    const grown = new ExpandNode().data({ matrix: [[[1, 2]]], rows: [2], cols: [3], fill: [0] }).result as unknown[][];
    expect(grown).toEqual([[1, 2, 0], [0, 0, 0]]);
    const na = new ExpandNode().data({ matrix: [[[1]]], rows: [1], cols: [2] }).result as unknown[][];
    expect(na[0][0]).toBe(1);
    expect(isSolError(na[0][1])).toBe(true);
    expect(isSolError(new ExpandNode().data({ matrix: [[[1, 2], [3, 4]]], rows: [1] }).result)).toBe(true);
  });

  it("CHOOSEROWS selects rows from a text matrix by 1-based index", () => {
    const n = new TableSelectNode({ op: "chooserows" });
    expect(dt(n.outputs.result?.socket)).toBe("anytable");
    expect(n.data({ matrix: [[["a", "b"], ["c", "d"], ["e", "f"]]], indices: [[1, 3]] }).result)
      .toEqual([["a", "b"], ["e", "f"]]);
  });

  it("Table Info reports dimensions of a text matrix", () => {
    const n = new TableInfoNode();
    const out = n.data({ matrix: [[["a", "b", "c"], ["d", "e", "f"]]] });
    expect(out.rows).toBe(2);
    expect(out.cols).toBe(3);
  });

  it("Table Info reports a FRAME's shape (rows × columns), not 1×1", async () => {
    const { frameFromCells } = await import("../frame");
    // 4 rows, 2 named columns (one with a gap) — a frame is not a row-major matrix,
    // so it must be measured directly rather than read as a scalar.
    const f = frameFromCells(["vals", "tag"], [[1, "a"], [null, "b"], [3, "c"], [4, "d"]]);
    const out = new TableInfoNode().data({ matrix: [f] });
    expect(out.rows).toBe(4);
    expect(out.cols).toBe(2);
  });
});

// An anytable that's actually text can connect to a strictly-numeric matrix input
// (both are 2-D, so the socket allows it — see docs/backlog.md). The numeric ops
// guard at runtime with #TYPE! instead of producing NaN soup.
describe("numeric matrix ops reject a text anytable with #TYPE!", () => {
  it("MMULT returns #TYPE! when an operand is a text matrix", () => {
    const n = new TableMultNode();
    const out = n.data({ a: [[["x", "y"], ["z", "w"]]], b: [[[1, 0], [0, 1]]] });
    expect(isSolError(out.result) && out.result.code).toBe("#TYPE!");
  });

  it("MMULT still multiplies numeric matrices (no regression)", () => {
    const n = new TableMultNode();
    const out = n.data({ a: [[[1, 2], [3, 4]]], b: [[[1, 0], [0, 1]]] });
    expect(out.result).toEqual([[1, 2], [3, 4]]);
  });

  it("MDETERM returns #TYPE! on a text matrix", () => {
    const n = new MatDetNode({ op: "mdeterm" });
    const out = n.data({ matrix: [[["a", "b"], ["c", "d"]]] });
    expect(isSolError(out.result) && out.result.code).toBe("#TYPE!");
  });

  it("MINVERSE returns #TYPE! on a text matrix", () => {
    const n = new MatDetNode({ op: "minverse" });
    const out = n.data({ matrix: [[["a", "b"], ["c", "d"]]] });
    expect(isSolError(out.result) && out.result.code).toBe("#TYPE!");
  });

  it("MDETERM still computes on numbers (no regression)", () => {
    const n = new MatDetNode({ op: "mdeterm" });
    const out = n.data({ matrix: [[[1, 2], [3, 4]]] });
    expect(out.result).toBe(-2);
  });
});

describe("matrix null (Inc 6): parse preserves blanks; numeric ops reject missing cells", () => {
  it("parseTableText: a blank cell → null (not 0); non-numeric → reject whole table", () => {
    // An all-blank row (just ",") is greedily dropped by the CSV reader → empty → null.
    expect(parseTableText(",")).toBeNull();
    // But blanks in rows that have content are preserved as null (not 0).
    expect(parseTableText("1,\n,4")).toEqual([[1, null], [null, 4]]);
    expect(parseTableText("1, 2\n3, 4")).toEqual([[1, 2], [3, 4]]);
    expect(parseTableText("1, abc")).toBeNull();
  });
  it("MMULT / MDETERM reject a matrix with a missing cell (#VALUE!, complete data needed)", () => {
    const mm = new TableMultNode().data({ a: [[[1, null], [3, 4]]] as never, b: [[[1, 0], [0, 1]]] as never }).result;
    expect(isSolError(mm) && mm.code).toBe("#VALUE!");
    const det = new MatDetNode({ op: "mdeterm" }).data({ matrix: [[[1, null], [3, 4]]] as never }).result;
    expect(isSolError(det) && det.code).toBe("#VALUE!");
  });

  it("a Table Input edit round-trips null (tableToText → parseTableText), no 0-fabrication", async () => {
    const { tableToText } = await import("./matrix");
    // The popup's fromGrid now keeps a blank cell as null; tableToText writes it as
    // a blank field, and parseTableText reads it back as null — no false 0.
    const edited: (number | null)[][] = [[1, null], [null, 4]];
    expect(parseTableText(tableToText(edited))).toEqual([[1, null], [null, 4]]);
  });
});
