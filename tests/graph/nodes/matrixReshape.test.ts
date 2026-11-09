// [[C17]]
import { describe, it, expect } from "vitest";
import { TableTransposeNode, TableReshapeNode, TableSelectNode, TableInfoNode, TableInputNode, tableRawCells, rawCellsToText, type TableElemType } from "../../../src/graph/nodes/matrix";
import { SolenoidSocket, type SocketDataType } from "../../../src/graph/sockets";

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

  // [[D85]] columnsStayColumns: TOCOL is a one-column table, TOROW a list; both read row by row, as Excel's do.
  it("TOCOL stacks a text matrix into one column; TOROW lines it up as a list", () => {
    const col = new TableReshapeNode({ op: "tocol" });
    expect(dt(col.outputs.result?.socket)).toBe("anytable");
    expect(col.data({ matrix: [[["a", "b"], ["c", "d"]]] }).result).toEqual([["a"], ["b"], ["c"], ["d"]]);
    const row = new TableReshapeNode({ op: "torow" });
    expect(dt(row.outputs.result?.socket)).toBe("anylist");
    expect(row.data({ matrix: [[["a", "b"], ["c", "d"]]] }).result).toEqual(["a", "b", "c", "d"]);
  });

  it("switching between a wrap op and a flatten op reshapes the card's sockets", () => {
    const n = new TableReshapeNode({ op: "wraprows" });
    expect(n.keysDroppedBySwitch("torow").sort()).toEqual(["fill", "list", "wrapCount"]);
    expect(n.setOp("torow")).toEqual({ outputChanged: true });
    expect(Object.keys(n.inputs)).toEqual(["matrix"]);
    expect(dt(n.outputs.result?.socket)).toBe("anylist");
    expect(n.setOp("tocol")).toEqual({ outputChanged: true });
    expect(dt(n.outputs.result?.socket)).toBe("anytable");
    n.setOp("wrapcols");
    expect(Object.keys(n.inputs)).toEqual(["list", "wrapCount", "fill"]);
  });

  it("WRAPROWS builds a text matrix from a text list", () => {
    const n = new TableReshapeNode({ op: "wraprows" });
    expect(dt(n.outputs.result?.socket)).toBe("anytable");
    expect(n.data({ list: [["a", "b", "c", "d"]], wrapCount: [2] }).result).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });






  it("CHOOSEROWS selects rows from a text matrix by 1-based index", () => {
    const n = new TableSelectNode({ op: "chooserows" });
    expect(dt(n.outputs.result?.socket)).toBe("anytable");
    expect(n.data({ matrix: [[["a", "b"], ["c", "d"], ["e", "f"]]], indices: [[1, 3]] }).result)
      .toEqual([["a", "b"], ["e", "f"]]);
  });




  it("Table Info reports a FRAME's shape (rows × columns), not 1×1", async () => {
    const { frameFromCells } = await import("../../../src/graph/frame");
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

/** What a Table Input of this text and element type answers. */
const tableOf = (tableText: string, dataType: TableElemType) => new TableInputNode({ tableText, dataType }).data().table;

describe("Table Input is a LITERAL source (the Frame Input model)", () => {
  it("blank cell → null; an unparseable cell → NaN (dirty data), never a whole-table reject", () => {
    // Old parseTableText nulled the ENTIRE table on one bad cell; the literal
    // model keeps the good cells and marks the bad one NaN (quiet affordance,
    // 1.0-tail #6 — not an error badge).
    const t = tableOf("1,\n,4", "number");
    expect(t).toEqual([[1, null], [null, 4]]);
    const bad = tableOf("1, abc\n3, 4", "number") as (number | null)[][];
    expect(bad[0][0]).toBe(1);
    expect(Number.isNaN(bad[0][1])).toBe(true);
    expect(bad[1]).toEqual([3, 4]);
  });

  it("a trailing all-blank column is a typing artifact and is stripped; interior blanks stay", () => {
    // "10,\n20," — a trailing comma per line — must stay a LIST (one column),
    // not silently become a 2-D table that flips Filter's shape rules.
    expect(tableRawCells("10,\n20,")).toEqual([["10"], ["20"]]);
    // An interior blank column is real missing data and survives.
    expect(tableRawCells("1,,3\n4,,6")).toEqual([["1", "", "3"], ["4", "", "6"]]);
  });

  it("a blank ROW is a row of missing cells — kept in the Source, null in the matrix (author 2026-07-16)", () => {
    // Blank lines → rows of empty raw cells, deriving to nulls — LEADING,
    // interior, and TRAILING alike (tables get set up with blank rows for
    // operations). They used to be dropped ENTIRELY (parseCsvRows' greedy skip)
    // — and since the grid popup re-serializes through this parse, a popup save
    // deleted them for good.
    expect(tableRawCells("1, 2\n\n3, 4")).toEqual([["1", "2"], ["", ""], ["3", "4"]]);
    expect(tableOf("1, 2\n\n3, 4", "number")).toEqual([[1, 2], [null, null], [3, 4]]);
    expect(tableRawCells("\n1, 2")).toEqual([["", ""], ["1", "2"]]);
    // A deliberate trailing blank LINE is a row; the text's final newline is
    // just the line TERMINATOR (one phantom segment, not a row).
    expect(tableRawCells("1, 2\n3, 4\n")).toEqual([["1", "2"], ["3", "4"]]);
    expect(tableRawCells("1, 2\n3, 4\n\n")).toEqual([["1", "2"], ["3", "4"], ["", ""]]);
    // Round trips: interior AND trailing blank rows survive text → cells → text,
    // including the single-column case (a blank row = a bare empty line).
    for (const cells of [
      tableRawCells("1, 2\n\n3, 4"),
      [["1", "2"], ["3", "4"], ["", ""]],
      [["1"], [""], ["3"]],
      [["1"], ["3"], [""]],
    ]) {
      expect(tableRawCells(rawCellsToText(cells))).toEqual(cells);
    }
  });

  it("raw cells round-trip verbatim through the text form (quoting incl.)", () => {
    const cells = [["1", "abc"], ["he, said", '"hi"']];
    expect(tableRawCells(rawCellsToText(cells))).toEqual(cells);
  });

  it("the element-type toggle derives text/date/logical tables from the same raw text", () => {
    const raw = tableRawCells("a, b\nc,");
    expect(tableOf(rawCellsToText(raw), "string")).toEqual([["a", "b"], ["c", null]]);
    const logical = tableOf("true, FALSE\n1, x", "logical") as unknown[][];
    expect(logical[0]).toEqual([true, false]);
    expect(logical[1][0]).toBe(true); // numeric text reads by the number: non-zero is TRUE
    expect(logical[1][1]).toBeNaN();
    const dates = tableOf("2026-03-15", "date") as number[][];
    expect(dates[0][0]).toBe(46096); // the audit-29 serial pin
  });

  it("setDataType swaps the output socket in place; dataType persists via init", () => {
    const n = new TableInputNode({ tableText: "a, b", dataType: "string" });
    expect(n.data().table).toEqual([["a", "b"]]);
    expect(n.setDataType("string")).toBe(false); // unchanged → no-op
    expect(n.setDataType("logical")).toBe(true);
    expect((n.outputs.table!.socket as { dataType?: string }).dataType).toBe("logicaltable");
  });

});


