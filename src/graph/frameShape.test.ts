import { describe, it, expect } from "vitest";
import {
  shapeOf, shapeOfJoin, shapeOfAppend, shapeOfAddIndex, shapeOfSplitColumn, shapeOfFrameValue,
  type Shape,
} from "./frameShape";
import {
  selectColumns, dropColumns, renameColumns, sortByColumn, distinctRows, headRows, filterRows,
  groupByFrame, unpivotFrame, pivotFrame, joinFrames, appendFrames, addIndexColumn, splitColumn,
  type FrameOp,
} from "./frameVerbs";
import type { FrameValue, FrameColumn } from "./frame";
import { isSolError } from "./errorValue";

// Every assertion here checks shapeOf's DECLARED shape against the JS oracle's
// ACTUAL output columns for the same op + fixture — a mismatch is exactly the
// "caught seam error" docs/v2.0/02-shape-checking.md calls for. frameVerbs.ts is
// also the reference oracle the Rust/Polars backend is parity-tested against
// (frameVerbs.ts:1-7), so agreement here is a real cross-engine guarantee for the
// verbs `engine.rs` implements (select/drop/rename/sort/distinct/head/filter/
// groupBy/unpivot/join/append — see src-tauri/src/engine/tests.rs).

function col(name: string, type: FrameColumn["type"], values: FrameColumn["values"]): FrameColumn {
  return { name, type, values };
}
function frame(columns: FrameColumn[]): FrameValue {
  return { __frame: true, columns };
}
function actualShape(f: FrameValue): Shape {
  return shapeOfFrameValue(f);
}

const people = frame([
  col("Name", "string", ["Ann", "Bo", "Cy"]),
  col("Age", "number", [30, 25, 40]),
  col("Active", "logical", [true, false, true]),
  col("Joined", "date", [46000, 46001, 46002]),
]);

describe("shapeOf — select", () => {
  it("keeps only the named columns, in order, deduped", () => {
    const op: FrameOp = { kind: "select", columns: ["Age", "Name", "Age"] };
    const declared = shapeOf(op, actualShape(people));
    const real = selectColumns(people, op.columns);
    expect(declared).toEqual(actualShape(real));
  });

  it("throws #REF! for a missing column — same as the oracle", () => {
    const op: FrameOp = { kind: "select", columns: ["Nope"] };
    expect(() => shapeOf(op, actualShape(people))).toThrow();
    let code: string | undefined;
    try { shapeOf(op, actualShape(people)); } catch (e) { code = isSolError(e) ? e.code : undefined; }
    let realCode: string | undefined;
    try { selectColumns(people, op.columns); } catch (e) { realCode = isSolError(e) ? e.code : undefined; }
    expect(code).toBe(realCode);
    expect(code).toBe("#REF!");
  });
});

describe("shapeOf — drop", () => {
  it("removes named columns, ignoring unknowns", () => {
    const op: FrameOp = { kind: "drop", columns: ["Age", "Ghost"] };
    const declared = shapeOf(op, actualShape(people));
    expect(declared).toEqual(actualShape(dropColumns(people, op.columns)));
  });
});

describe("shapeOf — rename", () => {
  it("renames and dedupes collisions", () => {
    const op: FrameOp = { kind: "rename", map: { Age: "Name" } };
    const declared = shapeOf(op, actualShape(people));
    expect(declared).toEqual(actualShape(renameColumns(people, op.map)));
    expect(declared.columns.map((c) => c.name)).toEqual(["Name", "Name2", "Active", "Joined"]);
  });
});

describe("shapeOf — row-only ops (sort/distinct/head/filter) never reshape", () => {
  it("sort", () => {
    const op: FrameOp = { kind: "sort", by: "Age", dir: "asc" };
    expect(shapeOf(op, actualShape(people))).toEqual(actualShape(sortByColumn(people, op.by, op.dir)));
  });
  it("distinct", () => {
    const op: FrameOp = { kind: "distinct" };
    expect(shapeOf(op, actualShape(people))).toEqual(actualShape(distinctRows(people)));
  });
  it("head", () => {
    const op: FrameOp = { kind: "head", n: 2 };
    expect(shapeOf(op, actualShape(people))).toEqual(actualShape(headRows(people, op.n)));
  });
  it("filter", () => {
    const op: FrameOp = { kind: "filter", column: "Age", op: "gt", value: 25 };
    expect(shapeOf(op, actualShape(people))).toEqual(actualShape(filterRows(people, op.column, op.op, op.value)));
  });
});

describe("shapeOf — groupBy", () => {
  const sales = frame([
    col("Region", "string", ["East", "West", "East"]),
    col("Amount", "number", [10, 20, 30]),
    col("Closed", "date", [46000, 46001, 46002]),
  ]);

  it("keys + aggregates, min/max preserving the source type, count → number", () => {
    const op: FrameOp = {
      kind: "groupBy",
      keys: ["Region"],
      aggs: [
        { column: "Amount", op: "sum", as: "Total" },
        { column: "Closed", op: "max", as: "LastClosed" },
        { column: "Amount", op: "count", as: "N" },
      ],
    };
    const declared = shapeOf(op, actualShape(sales));
    expect(declared).toEqual(actualShape(groupByFrame(sales, op.keys, op.aggs)));
    expect(declared.columns).toEqual([
      { name: "Region", type: "string" },
      { name: "Total", type: "number" },
      { name: "LastClosed", type: "date" },
      { name: "N", type: "number" },
    ]);
  });

  it("dedupes an agg name colliding with the key", () => {
    const op: FrameOp = { kind: "groupBy", keys: ["Region"], aggs: [{ column: "Amount", op: "count", as: "Region" }] };
    const declared = shapeOf(op, actualShape(sales));
    expect(declared).toEqual(actualShape(groupByFrame(sales, op.keys, op.aggs)));
    expect(declared.columns.map((c) => c.name)).toEqual(["Region", "Region2"]);
  });
});

describe("shapeOf — unpivot", () => {
  it("id columns + variable + value, value type from the first value column", () => {
    const wide = frame([
      col("Id", "number", [1, 2]),
      col("Jan", "number", [10, 20]),
      col("Feb", "number", [11, 21]),
    ]);
    const op: FrameOp = { kind: "unpivot", idColumns: ["Id"], valueColumns: ["Jan", "Feb"] };
    const declared = shapeOf(op, actualShape(wide));
    expect(declared).toEqual(actualShape(unpivotFrame(wide, op.idColumns, op.valueColumns)));
    expect(declared.columns).toEqual([
      { name: "Id", type: "number" },
      { name: "variable", type: "string" },
      { name: "value", type: "number" },
    ]);
  });
});

describe("shapeOf — pivot", () => {
  const long = frame([
    col("Region", "string", ["East", "West", "East"]),
    col("Product", "string", ["A", "A", "B"]),
    col("Amount", "number", [10, 20, 30]),
  ]);

  it("declares the row-key columns and flags the body as dynamic", () => {
    const op = { kind: "pivot" as const, rowFields: ["Region"], colFields: ["Product"], values: ["Amount"], funcs: ["sum" as const] };
    const declared = shapeOf(op, actualShape(long));
    expect(declared.dynamic).toBe(true);
    expect(declared.columns).toEqual([{ name: "Region", type: "string" }]);
    // The real verb's row-key columns match what we declared (the part that IS static).
    const real = pivotFrame(long, op);
    expect(real.columns[0].name).toBe(declared.columns[0].name);
    expect(real.columns[0].type).toBe(declared.columns[0].type);
  });

  it("throws #VALUE! with no value field — same as the oracle", () => {
    const op = { kind: "pivot" as const, rowFields: ["Region"], colFields: [], values: [], funcs: [] };
    let code: string | undefined;
    try { shapeOf(op, actualShape(long)); } catch (e) { code = isSolError(e) ? e.code : undefined; }
    let realCode: string | undefined;
    try { pivotFrame(long, op); } catch (e) { realCode = isSolError(e) ? e.code : undefined; }
    expect(code).toBe(realCode);
    expect(code).toBe("#VALUE!");
  });
});

describe("shapeOfJoin", () => {
  const left = frame([col("Id", "number", [1, 2]), col("Qty", "number", [10, 20])]);
  const right = frame([col("Fk", "number", [1, 1]), col("Name", "string", ["x", "y"])]);

  it("left columns + right non-key columns, deduped", () => {
    const opts = { leftKey: "Id", rightKey: "Fk", how: "inner" as const };
    const declared = shapeOfJoin(actualShape(left), actualShape(right), opts);
    expect(declared).toEqual(actualShape(joinFrames(left, right, opts)));
    expect(declared.columns.map((c) => c.name)).toEqual(["Id", "Qty", "Name"]);
  });

  it("throws #REF! for a missing key column", () => {
    const opts = { leftKey: "Nope", rightKey: "Fk", how: "inner" as const };
    let code: string | undefined;
    try { shapeOfJoin(actualShape(left), actualShape(right), opts); } catch (e) { code = isSolError(e) ? e.code : undefined; }
    expect(code).toBe("#REF!");
  });
});

describe("shapeOfAppend", () => {
  it("unions columns by name, filling gaps", () => {
    const a = frame([col("X", "number", [1]), col("Y", "number", [2])]);
    const b = frame([col("Y", "number", [3])]);
    const declared = shapeOfAppend([actualShape(a), actualShape(b)]);
    expect(declared).toEqual(actualShape(appendFrames([a, b])));
    expect(declared.columns.map((c) => c.name)).toEqual(["X", "Y"]);
  });

  it("throws #TYPE! on a conflicting shared column — same as the oracle", () => {
    const a = frame([col("X", "number", [1])]);
    const b = frame([col("X", "string", ["a"])]);
    let code: string | undefined;
    try { shapeOfAppend([actualShape(a), actualShape(b)]); } catch (e) { code = isSolError(e) ? e.code : undefined; }
    let realCode: string | undefined;
    try { appendFrames([a, b]); } catch (e) { realCode = isSolError(e) ? e.code : undefined; }
    expect(code).toBe(realCode);
    expect(code).toBe("#TYPE!");
  });
});

describe("shapeOfAddIndex", () => {
  it("prepends one numeric column, deduping its name", () => {
    const f = frame([col("Index", "string", ["a"])]);
    const declared = shapeOfAddIndex(actualShape(f), "Index");
    expect(declared).toEqual(actualShape(addIndexColumn(f, "Index", 1)));
    expect(declared.columns.map((c) => c.name)).toEqual(["Index", "Index2"]);
  });
});

describe("shapeOfSplitColumn", () => {
  it("drops the source column and flags the result dynamic", () => {
    const f = frame([col("Name", "string", ["a,b", "c,d,e"]), col("Age", "number", [1, 2])]);
    const declared = shapeOfSplitColumn(actualShape(f), "Name", ",");
    expect(declared.dynamic).toBe(true);
    expect(declared.columns.map((c) => c.name)).toEqual(["Age"]);
    // The real verb's untouched column matches what we declared.
    const real = splitColumn(f, "Name", ",");
    expect(real.columns.find((c) => c.name === "Age")?.type).toBe("number");
  });

  it("is a no-op shape for an empty delimiter — matches the oracle exactly", () => {
    const f = frame([col("Name", "string", ["a,b"])]);
    const declared = shapeOfSplitColumn(actualShape(f), "Name", "");
    expect(declared).toEqual(actualShape(splitColumn(f, "Name", "")));
  });
});
