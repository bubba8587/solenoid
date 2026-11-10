// [[C22]] rowFormulaRefs, [[frame-verbs#pivot]]
// A column name that differs from a real one only in letter case is a slip, and the answer says so rather than
// reading blank or 0: Get Column, a computed column's `@name` and bare name, a pivot field and a calculated field.
import { describe, it, expect } from "vitest";
import { ComputedColumnNode, GetColumnNode, PivotNode } from "../../../src/graph/nodes/frame";
import { LambdaNode } from "../../../src/graph/nodes/lambda";
import { caseTwin, columnNotFound, type FrameValue } from "../../../src/graph/frame";
import { isSolError } from "../../../src/graph/errorValue";

const log: FrameValue = {
  __frame: true,
  columns: [
    { name: "date", type: "string", values: ["2026-01-05", "2026-01-06"] },
    { name: "Qty", type: "number", values: [3, 4] },
  ],
};
const HINT = "Column names are case sensitive";
const message = (v: unknown) => (isSolError(v) ? v.message ?? "" : "");

describe("a column name off only by letter case", () => {
  it("names the column it likely meant, and only when case is the whole difference", () => {
    expect(caseTwin("Date", ["date", "Qty"])).toBe("date");
    expect(caseTwin("Dates", ["date"])).toBeUndefined();
    expect(caseTwin("date", ["date"])).toBeUndefined();
    expect(columnNotFound("Dates", ["date"])).toBe('column "Dates" not found');
  });

  it("Get Column says so", () => {
    const v = new GetColumnNode().data({ frame: [log], name: ["QTY"] }).values;
    expect(message(v)).toContain(`${HINT}: the table has "Qty"`);
    const far = new GetColumnNode().data({ frame: [log], name: ["Amount"] }).values;
    expect(message(far)).not.toContain(HINT);
  });

  it("a computed column's @name and bare name answer #REF! rather than 0", () => {
    for (const expr of ["@[Date]", "@qty * 2", "SUM(qty)"]) {
      const n = new ComputedColumnNode({ expr });
      n.stringLiterals.name = "Out";
      const out = n.data({ frame: [log] }).frame as FrameValue;
      const cells = out.columns.find((c) => c.name === "Out")!.values;
      for (const c of cells) {
        expect(isSolError(c), expr).toBe(true);
        expect(message(c), expr).toContain(HINT);
      }
    }
  });

  it("a name typed into its own input stays an input", () => {
    const n = new ComputedColumnNode({ expr: "@Qty * rate" });
    n.stringLiterals.name = "Out";
    const out = n.data({ frame: [log], rate: [2] }).frame as FrameValue;
    expect(out.columns.find((c) => c.name === "Out")!.values).toEqual([6, 8]);
  });

  it("a pivot field and a calculated field's parameter say so", () => {
    const p = new PivotNode();
    const v = p.data({ frame: [log], rowFields: [["Date"]], colFields: [[]], values: [["Qty"]] }).frame;
    expect(message(v)).toContain(`${HINT}: the table has "date"`);

    const lam = new LambdaNode({ params: "qty", expr: "SUM(qty)" });
    const fn = lam.data({}).result;
    const calc = new PivotNode({ valueKeys: ["calcName0", "calcFn0"] });
    calc.stringLiterals.calcName0 = "Total";
    const out = calc.data({ frame: [log], rowFields: [["date"]], colFields: [[]], values: [[]], calcFn0: [fn] }).frame as FrameValue;
    const cell = out.columns.find((c) => c.name === "Total")!.values[0];
    expect(message(cell)).toContain(`${HINT}: the table has "Qty"`);
  });
});
