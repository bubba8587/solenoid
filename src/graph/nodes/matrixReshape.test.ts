import { describe, it, expect } from "vitest";
import { isSolError } from "../errorValue";
import { TableTransposeNode, HStackTableNode, TableReshapeNode, TableSelectNode, TableTakeDropNode, ExpandNode, TableInfoNode, TableMultNode, MatDetNode, TableInputNode, tableRawCells, rawCellsToText, deriveTable } from "./matrix";
import { SolenoidSocket, MutableSocket, type SocketDataType } from "../sockets";
import { withMatrixUnit, matrixUnitOf, isUnitCell, type UnitCell } from "../unitValue";
import { ListIndexNode } from "./list";
import { wrapNodeData } from "../coerceInputs";

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
    expect(dt(n.outputs.result?.socket)).toBe("anylist"); // 1-D, untyped element
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

  it("EXPAND grows with the fill (unwired fill pads null); shrinking is #VALUE!", () => {
    const grown = new ExpandNode().data({ matrix: [[[1, 2]]], rows: [2], cols: [3], fill: [0] }).result as unknown[][];
    expect(grown).toEqual([[1, 2, 0], [0, 0, 0]]);
    // Unwired Fill = first-class missing (author 2026-07-16), not Excel's #N/A —
    // wire the NA node into Fill for the Excel pad_with-omitted behaviour.
    const padded = new ExpandNode().data({ matrix: [[[1]]], rows: [1], cols: [2] }).result as unknown[][];
    expect(padded).toEqual([[1, null]]);
    expect(isSolError(new ExpandNode().data({ matrix: [[[1, 2], [3, 4]]], rows: [1] }).result)).toBe(true);
  });

  it("CHOOSEROWS selects rows from a text matrix by 1-based index", () => {
    const n = new TableSelectNode({ op: "chooserows" });
    expect(dt(n.outputs.result?.socket)).toBe("anytable");
    expect(n.data({ matrix: [[["a", "b"], ["c", "d"], ["e", "f"]]], indices: [[1, 3]] }).result)
      .toEqual([["a", "b"], ["e", "f"]]);
  });

  it("CHOOSEROWS negative index counts from the end; CHOOSECOLS picks columns", () => {
    const rows = new TableSelectNode({ op: "chooserows" });
    expect(rows.data({ matrix: [[["a", "b"], ["c", "d"], ["e", "f"]]], indices: [[-1, 1]] }).result)
      .toEqual([["e", "f"], ["a", "b"]]);
    const cols = new TableSelectNode({ op: "choosecols" });
    expect(cols.data({ matrix: [[["a", "b", "c"], ["d", "e", "f"]]], indices: [[3, 1]] }).result)
      .toEqual([["c", "a"], ["f", "d"]]);
  });

  it("CHOOSEROWS/CHOOSECOLS: an out-of-range or zero index errors the whole call with #VALUE! (Excel), not a NaN-padded row", () => {
    const mat = [["a", "b"], ["c", "d"], ["e", "f"]];
    const over = new TableSelectNode({ op: "chooserows" }).data({ matrix: [mat], indices: [[1, 4]] }).result;
    expect(isSolError(over) && over.code).toBe("#VALUE!");
    // Index 0 is invalid — Excel's indices are 1-based (negatives count from the end).
    const zero = new TableSelectNode({ op: "chooserows" }).data({ matrix: [mat], indices: [[0]] }).result;
    expect(isSolError(zero) && zero.code).toBe("#VALUE!");
    const colOver = new TableSelectNode({ op: "choosecols" }).data({ matrix: [mat], indices: [[5]] }).result;
    expect(isSolError(colOver) && colOver.code).toBe("#VALUE!");
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

describe("Table Input is a LITERAL source (the Frame Input model)", () => {
  it("blank cell → null; an unparseable cell → NaN (dirty data), never a whole-table reject", () => {
    // Old parseTableText nulled the ENTIRE table on one bad cell; the literal
    // model keeps the good cells and marks the bad one NaN (quiet affordance,
    // 1.0-tail #6 — not an error badge).
    const t = deriveTable(tableRawCells("1,\n,4"), "number");
    expect(t).toEqual([[1, null], [null, 4]]);
    const bad = deriveTable(tableRawCells("1, abc\n3, 4"), "number") as (number | null)[][];
    expect(bad[0][0]).toBe(1);
    expect(Number.isNaN(bad[0][1])).toBe(true);
    expect(bad[1]).toEqual([3, 4]);
  });

  it("a trailing all-blank column is a typing artifact and is stripped; interior blanks stay", () => {
    // "10,\n20," — a trailing comma per line — must stay a LIST (one column),
    // not silently become a 2-D table that flips Filter's shape rules.
    expect(tableRawCells("10,\n20,")).toEqual([["10"], ["20"]]);
    // An interior blank column is real missing data.
    expect(tableRawCells("1,,3\n4,,6")).toEqual([["1", "", "3"], ["4", "", "6"]]);
  });

  it("a trailing all-blank column is a typing artifact and is stripped; interior blanks stay", () => {
    // "10,\n20," — a trailing comma per line — must stay a LIST (one column),
    // not silently become a 2-D table that flips Filter's shape rules.
    expect(tableRawCells("10,\n20,")).toEqual([["10"], ["20"]]);
    // An interior blank column is real missing data.
    expect(tableRawCells("1,,3\n4,,6")).toEqual([["1", "", "3"], ["4", "", "6"]]);
  });

  it("a trailing all-blank column is a typing artifact and is stripped; interior blanks stay", () => {
    // "10,\n20," — a trailing comma per line — must stay a LIST (one column),
    // not silently become a 2-D table that flips Filter's shape rules.
    expect(tableRawCells("10,\n20,")).toEqual([["10"], ["20"]]);
    // An interior blank column is real missing data and survives.
    expect(tableRawCells("1,,3\n4,,6")).toEqual([["1", "", "3"], ["4", "", "6"]]);
  });

  it("raw cells round-trip verbatim through the text form (quoting incl.)", () => {
    const cells = [["1", "abc"], ["he, said", '"hi"']];
    expect(tableRawCells(rawCellsToText(cells))).toEqual(cells);
  });

  it("the element-type toggle derives text/date/logical tables from the same raw text", () => {
    const raw = tableRawCells("a, b\nc,");
    expect(deriveTable(raw, "string")).toEqual([["a", "b"], ["c", null]]);
    const logical = deriveTable(tableRawCells("true, 0\n1, x"), "logical") as unknown[][];
    expect(logical[0]).toEqual([true, false]);
    expect(logical[1][0]).toBe(true);
    expect(logical[1][1]).toBeNull(); // a bad logical is null — coerceLogical's (Frame Input's) contract
    const dates = deriveTable(tableRawCells("2026-03-15"), "date") as number[][];
    expect(dates[0][0]).toBe(46096); // the audit-29 serial pin
  });

  it("setDataType swaps the output socket in place; dataType persists via init", () => {
    const n = new TableInputNode({ tableText: "a, b", dataType: "string" });
    expect(n.data().table).toEqual([["a", "b"]]);
    expect(n.setDataType("string")).toBe(false); // unchanged → no-op
    expect(n.setDataType("logical")).toBe(true);
    expect((n.outputs.table!.socket as { dataType?: string }).dataType).toBe("logicaltable");
  });

  it("MMULT / MDETERM reject a matrix with a missing cell (#VALUE!, complete data needed)", () => {
    const mm = new TableMultNode().data({ a: [[[1, null], [3, 4]]] as never, b: [[[1, 0], [0, 1]]] as never }).result;
    expect(isSolError(mm) && mm.code).toBe("#VALUE!");
    const det = new MatDetNode({ op: "mdeterm" }).data({ matrix: [[[1, null], [3, 4]]] as never }).result;
    expect(isSolError(det) && det.code).toBe("#VALUE!");
  });
});

describe("structural reshapes carry the homogeneous matrix unit (D20, S3)", () => {
  // A numeric matrix tagged with one whole-grid unit; the tag rides through a
  // structural reshape (same cells, rearranged) but the output is a fresh array,
  // so the op must re-carry it. km, dim {length:1}.
  const tagged = () => withMatrixUnit([[1, 2], [3, 4]], { dim: { length: 1 }, display: "km" });

  it("TRANSPOSE carries the unit onto the flipped grid", () => {
    const r = new TableTransposeNode().data({ matrix: [tagged()] }).result;
    expect(r).toEqual([[1, 3], [2, 4]]);
    expect(matrixUnitOf(r)).toMatchObject({ display: "km" });
  });

  it("CHOOSEROWS / CHOOSECOLS carry the unit", () => {
    const rows = new TableSelectNode({ op: "chooserows" }).data({ matrix: [tagged()], indices: [[1]] }).result;
    expect(matrixUnitOf(rows)).toMatchObject({ display: "km" });
    const cols = new TableSelectNode({ op: "choosecols" }).data({ matrix: [tagged()], indices: [[2]] }).result;
    expect(matrixUnitOf(cols)).toMatchObject({ display: "km" });
  });

  it("TAKE (table) carries the unit onto the trimmed grid", () => {
    const r = new TableTakeDropNode({ op: "take" }).data({ matrix: [tagged()], rows: [1], cols: [0] }).result;
    expect(r).toEqual([[1, 2]]);
    expect(matrixUnitOf(r)).toMatchObject({ display: "km" });
  });

  it("EXPAND carries the unit; the pad reads in that same unit", () => {
    const r = new ExpandNode().data({ matrix: [tagged()], rows: [3], cols: [2], fill: [0] }).result;
    expect(matrixUnitOf(r)).toMatchObject({ display: "km" });
  });

  it("an untagged (plain / text) matrix stays untagged through a reshape", () => {
    const r = new TableTransposeNode().data({ matrix: [[[1, 2], [3, 4]]] }).result;
    expect(matrixUnitOf(r)).toBeUndefined();
    const t = new TableTransposeNode().data({ matrix: [[["a", "b"], ["c", "d"]]] }).result;
    expect(matrixUnitOf(t)).toBeUndefined();
  });

  it("Table Input tags its NUMBER output with its authored unit; cells stay as-typed", () => {
    const n = new TableInputNode({ tableText: "1, 2\n3, 4", dataType: "number", unit: "km" });
    const out = n.data().table;
    expect(out).toEqual([[1, 2], [3, 4]]);          // cells bare, as typed (D20)
    expect(matrixUnitOf(out)).toMatchObject({ display: "km" });
  });

  it("Table Input unit only applies to a number table; none / text pass untagged", () => {
    expect(matrixUnitOf(new TableInputNode({ tableText: "1, 2", dataType: "number", unit: "none" }).data().table)).toBeUndefined();
    expect(matrixUnitOf(new TableInputNode({ tableText: "a, b", dataType: "string", unit: "km" }).data().table)).toBeUndefined();
  });

  it("Table Input unit round-trips through init (persistence whitelist)", () => {
    const n = new TableInputNode({ tableText: "1", dataType: "number", unit: "usd" });
    expect(n.unit).toBe("usd");
  });

  it("INDEX carries the matrix unit out into an extracted cell / row / column", () => {
    // Single cell — tagged out as a UnitCell carrying the display id (like a frame
    // column's Get Column / INDEX), so the unit doesn't vanish (the user-flagged bug).
    const cell = new ListIndexNode().data({ list: [tagged()], index: [1], column: [2] }).result;
    expect(isUnitCell(cell)).toBe(true);
    expect((cell as unknown as UnitCell).display).toBe("km");
    // Whole column (row = [all] = 0) — a list of tagged cells.
    const col = new ListIndexNode().data({ list: [tagged()], index: [0], column: [1] }).result as unknown as UnitCell[];
    expect(Array.isArray(col)).toBe(true);
    expect(col.every((x) => isUnitCell(x) && x.display === "km")).toBe(true);
    // Whole row (column = [all]) — a list of tagged cells.
    const row = new ListIndexNode().data({ list: [tagged()], index: [1], column: [0] }).result as unknown as UnitCell[];
    expect(row.every((x) => isUnitCell(x) && x.display === "km")).toBe(true);
  });

  it("INDEX on a PLAIN (untagged) matrix returns bare numbers (no spurious unit)", () => {
    const cell = new ListIndexNode().data({ list: [[[1, 2], [3, 4]]], index: [1], column: [2] }).result;
    expect(cell).toBe(2);
    expect(isUnitCell(cell)).toBe(false);
  });

  it("INDEX keeps the matrix unit through the REAL coercion path (adoptive socket adopts 'table')", () => {
    // The direct-data() tests above bypass coerceInputs. In the live graph a numeric
    // matrix wired into INDEX's trueany input makes the socket ADOPT "table", and the
    // coercer runs toMatrix (rebuilds the array). This pins that the symbol tag now
    // survives that rebuild (carryMatrixUnit in coerceValue's "table" case).
    const n = new ListIndexNode();
    (n.inputs.list!.socket as MutableSocket).setType("table"); // simulate adoption
    wrapNodeData(n);
    const out = n.data({ list: [tagged()], index: [1], column: [2] }) as { result: unknown };
    expect(isUnitCell(out.result)).toBe(true);
    expect((out.result as unknown as UnitCell).display).toBe("km");
  });
});
