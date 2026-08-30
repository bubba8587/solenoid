import { describe, it, expect } from "vitest";
import { LambdaNode } from "../../src/graph/nodes/lambda";
import { MakeArrayNode } from "../../src/graph/nodes/tableLambda";
import { FilterNode } from "../../src/graph/nodes/list";
import { solError, isSolError, type SolError } from "../../src/graph/errorValue";
import { compilePositional } from "../../src/graph/excelFormula";
import { passesFilter, filterRowsMulti, VALUELESS_FILTER_OPS, ERROR_FILTER_OPS } from "../../src/graph/frameVerbs";
import type { FrameValue } from "../../src/graph/frame";

const code = (v: unknown) => (isSolError(v) ? (v as SolError).code : v);

// ─── #1: a list error no longer poisons a whole positional-lookup result ───────
describe("positional lookups don't blanket-error on an unreferenced error cell", () => {
  it("INDEX picks the cell; an error at another position doesn't propagate", () => {
    const idx = compilePositional("INDEX(data, n)", ["n", "data"])!;
    const data = [1, solError("#DIV/0!", "x"), 3];
    expect(idx(1, data)).toBe(1);            // was #DIV/0! before the fix
    expect(code(idx(2, data))).toBe("#DIV/0!"); // the picked cell IS the error (per-cell)
    expect(idx(3, data)).toBe(3);
  });

  it("XMATCH finds its value past an error cell instead of erroring wholesale", () => {
    const match = compilePositional("XMATCH(target, data)", ["target", "data"])!;
    expect(match(3, [1, solError("#DIV/0!", "x"), 3])).toBe(3); // 1-based position of 3
  });

  it("MAKEARRAY over INDEX(list, row) errors only the cells that reference the error", () => {
    const lam = new LambdaNode({ params: "row, col", expr: "INDEX(data, row)" });
    const lambdaVal = lam.data({ data: [[1, solError("#DIV/0!", "x"), 3]] }).result;
    const mk = new MakeArrayNode();
    const out = mk.data({ rows: [3], cols: [1], lambda: [lambdaVal] });
    expect((out.result as unknown[][]).map((r) => r.map(code))).toEqual([[1], ["#DIV/0!"], [3]]);
  });

  it("an AGGREGATE over an error range still propagates (Excel-correct)", () => {
    // Contrast: SUM of a range containing an error IS an error, both in Excel and here.
    const sum = compilePositional("SUM(data)", ["data"])!;
    expect(code(sum([1, solError("#DIV/0!", "x"), 3]))).toBe("#DIV/0!");
  });
});

// ─── #2: filter error cells out of a list / frame ──────────────────────────────
describe("error filter predicates", () => {
  it("passesFilter iserror / noterror select on the error state", () => {
    const err = solError("#DIV/0!", "x");
    expect(passesFilter(err, "iserror", "", "number", false)).toBe(true);
    expect(passesFilter(5, "iserror", "", "number", false)).toBe(false);
    expect(passesFilter(err, "noterror", "", "number", false)).toBe(false);
    expect(passesFilter(5, "noterror", "", "number", false)).toBe(true);
    expect(passesFilter(null, "noterror", "", "number", false)).toBe(true); // null isn't an error
    expect(VALUELESS_FILTER_OPS.has("noterror")).toBe(true);
    expect(ERROR_FILTER_OPS.has("iserror")).toBe(true);
  });

  it("List Filter 'noterror' drops error cells; Dropped keeps them", () => {
    const f = new FilterNode();
    // one condition row (value0), op noterror (no value needed)
    f.condConfig["0"] = { op: "noterror" };
    const out = f.data({ list: [[1, solError("#DIV/0!", "x"), 3, solError("#N/A", "y")]] });
    expect(out.result!.map(code)).toEqual([1, 3]);
    expect(out.dropped!.map(code)).toEqual(["#DIV/0!", "#N/A"]);
  });

  it("List Filter 'iserror' keeps only the error cells", () => {
    const f = new FilterNode();
    f.condConfig["0"] = { op: "iserror" };
    const out = f.data({ list: [[1, solError("#DIV/0!", "x"), 3]] });
    expect(out.result!.map(code)).toEqual(["#DIV/0!"]);
  });

  it("filterRowsMulti drops rows whose column holds an error (frame path)", () => {
    const frame: FrameValue = {
      __frame: true,
      columns: [
        { name: "id", type: "number", values: [1, 2, 3] },
        { name: "v", type: "number", values: [10, solError("#DIV/0!", "x"), 30] },
      ],
    };
    const kept = filterRowsMulti(frame, "and", [{ column: "v", op: "noterror", value: "" }]);
    expect(kept.columns[0].values).toEqual([1, 3]);
    const dropped = filterRowsMulti(frame, "and", [{ column: "v", op: "noterror", value: "" }], true);
    expect(dropped.columns[0].values).toEqual([2]);
  });
});
