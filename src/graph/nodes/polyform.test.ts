import { describe, it, expect } from "vitest";
import { ExpressionNode } from "./expression";
import { MapTableNode, ByAxisNode, ReduceLambdaNode, MakeArrayNode } from "./tableLambda";
import { LambdaNode } from "./lambda";
import { isSolError, type SolError } from "../errorValue";
import { SolenoidSocket, type SocketDataType } from "../sockets";

// Polyform: the formula producers loop ANY Excel function over arrays of any
// element type, declaring their output element type with a result selector that
// swaps the output socket at the node's dimensionality. Numeric behaviour is
// unchanged (see expression / tableLambda existing suites); these tests cover
// text + date results, the socket swap, and that the engine stays polymorphic.

const dt = (socket: unknown): SocketDataType | undefined =>
  socket instanceof SolenoidSocket ? socket.dataType : undefined;

describe("Expression — value-polymorphic results", () => {
  it("maps a text function over a list when resultAs = text", () => {
    const n = new ExpressionNode({ expr: "UPPER(name)", resultAs: "text" });
    expect(n.data({ name: [["alice", "bob"]] }).result).toEqual(["ALICE", "BOB"]);
  });

  it("concatenates with & into a single string", () => {
    const n = new ExpressionNode({ expr: 'first & " " & last', resultAs: "text" });
    expect(n.data({ first: ["Ada"], last: ["Lovelace"] }).result).toBe("Ada Lovelace");
  });

  it("passes a date serial through unchanged (date is a number)", () => {
    const n = new ExpressionNode({ expr: "d + 7", resultAs: "date" });
    expect(n.data({ d: [45000] }).result).toBe(45007);
  });

  it("keeps numeric behaviour identical (default resultAs = number)", () => {
    const n = new ExpressionNode({ expr: "a * b" });
    expect(n.data({ a: [[1, 2, 3]], b: [10] }).result).toEqual([10, 20, 30]);
  });

  it("aggregates a list with a range function (the new capability)", () => {
    const n = new ExpressionNode({ expr: "SUM(x)" });
    expect(n.data({ x: [[1, 2, 3, 4]] }).result).toBe(10);
  });

  it("computes x / SUM(x) — needs x both whole and element-wise", () => {
    const n = new ExpressionNode({ expr: "x / SUM(x)" });
    expect(n.data({ x: [[1, 3, 4]] }).result).toEqual([0.125, 0.375, 0.5]);
  });

  it("fails loud with #SHAPE! on a 2-D matrix input (P4 placeholder)", () => {
    const n = new ExpressionNode({ expr: "a * 2" });
    const r = n.data({ a: [[[1, 2], [3, 4]]] }).result;
    expect(isSolError(r) && r.code).toBe("#SHAPE!");
  });

  it("tags scalar division by zero as #DIV/0! (P5)", () => {
    const n = new ExpressionNode({ expr: "a / b" });
    const r = n.data({ a: [1], b: [0] }).result;
    expect(isSolError(r) && r.code).toBe("#DIV/0!");
  });

  it("maps a Formula.js domain error to #DOMAIN! (P5)", () => {
    const n = new ExpressionNode({ expr: "SQRT(a)" });
    const r = n.data({ a: [-1] }).result; // FX returns #NUM! → mapped
    expect(isSolError(r) && r.code).toBe("#DOMAIN!");
  });

  it("propagates a div-by-zero in a LIST as a per-cell #DIV/0! (relaxed invariant)", () => {
    // Array-semantics build: lists now carry per-cell errors instead of collapsing
    // to NaN. The other elements compute normally around the tagged cell.
    const n = new ExpressionNode({ expr: "1 / x" });
    const r = n.data({ x: [[1, 0, 2]] }).result as Array<number | SolError>;
    expect(Array.isArray(r)).toBe(true);
    expect(r[0]).toBe(1);
    expect(isSolError(r[1]) && (r[1] as SolError).code).toBe("#DIV/0!");
    expect(r[2]).toBe(0.5);
  });

  it("propagates a per-cell #DOMAIN! in a LIST (sqrt of a negative element)", () => {
    const n = new ExpressionNode({ expr: "SQRT(x)" });
    const r = n.data({ x: [[4, -1, 9]] }).result as Array<number | SolError>;
    expect(r[0]).toBe(2);
    expect(isSolError(r[1]) && (r[1] as SolError).code).toBe("#DOMAIN!");
    expect(r[2]).toBe(3);
  });

  it("passes per-element booleans through in a LIST (P7 logical — audit finding 27)", () => {
    const n = new ExpressionNode({ expr: "x > 2" });
    expect(n.data({ x: [[1, 3, 5]] }).result).toEqual([false, true, true]);
  });

  it("does not tag a normal finite scalar (strict-superset)", () => {
    const n = new ExpressionNode({ expr: "a / b" });
    expect(n.data({ a: [6], b: [2] }).result).toBe(3);
  });

  it("passes a scalar boolean comparison through (audit finding 27)", () => {
    // Comparisons return a real logical now — display renders TRUE/FALSE and
    // the logical↔number bridge covers numeric consumers.
    const n = new ExpressionNode({ expr: "a > b" });
    expect(n.data({ a: [5], b: [3] }).result).toBe(true);
  });

  it("swaps the output socket to match the declared result type", () => {
    expect(dt(new ExpressionNode({ resultAs: "number" }).outputs.result?.socket)).toBe("numlist");
    expect(dt(new ExpressionNode({ resultAs: "text" }).outputs.result?.socket)).toBe("strcombo");
    expect(dt(new ExpressionNode({ resultAs: "date" }).outputs.result?.socket)).toBe("datecombo");
    expect(dt(new ExpressionNode({ resultAs: "auto" }).outputs.result?.socket)).toBe("any");
  });

  it("the 2-D producers: Number default is the numeric matrix; Auto is anytable (D17)", () => {
    expect(dt(new MapTableNode().outputs.result?.socket)).toBe("table"); // default resultAs: number
    expect(dt(new MapTableNode({ resultAs: "auto" }).outputs.result?.socket)).toBe("anytable");
    expect(dt(new MakeArrayNode({ resultAs: "auto" }).outputs.result?.socket)).toBe("anytable");
  });

  it("variable inputs are `any` so text/date arrays connect", () => {
    const n = new ExpressionNode({ expr: "UPPER(name)", resultAs: "text" });
    expect(dt(n.inputs.name?.socket)).toBe("anylist");
  });
});

describe("MAP — text & date matrices", () => {
  it("TEXTJOINs two text columns with an index (the author's case)", () => {
    const n = new MapTableNode({ expr: 'x & " " & y & " #" & r', resultAs: "text" });
    const r = n.data({
      table:  [[["John"], ["Jane"]]],
      table2: [[["Doe"], ["Roe"]]],
    }).result;
    expect(r).toEqual([["John Doe #1"], ["Jane Roe #2"]]);
  });

  it("maps a date function over a date matrix", () => {
    const n = new MapTableNode({ expr: "x + 1", resultAs: "date" });
    expect(n.data({ table: [[[45000, 45001]]] }).result).toEqual([[45001, 45002]]);
  });

  it("output socket follows the result type (matrix level)", () => {
    expect(dt(new MapTableNode({ resultAs: "number" }).outputs.result?.socket)).toBe("table");
    expect(dt(new MapTableNode({ resultAs: "text" }).outputs.result?.socket)).toBe("strtable");
    expect(dt(new MapTableNode({ resultAs: "date" }).outputs.result?.socket)).toBe("datetable");
  });

  it("value inputs are the 2-D `anytable` (a 1-D list widens in)", () => {
    const n = new MapTableNode();
    expect(dt(n.inputs.table?.socket)).toBe("anytable");
    expect(dt(n.inputs.table2?.socket)).toBe("anytable");
  });

  it("a per-cell error in a mapped matrix propagates (#DIV/0!); good cells compute", () => {
    const r = new MapTableNode({ expr: "1 / x", resultAs: "number" })
      .data({ table: [[[1, 0, 2]]] }).result as Array<Array<number | SolError>>;
    expect(r[0][0]).toBe(1);
    expect(isSolError(r[0][1]) && (r[0][1] as SolError).code).toBe("#DIV/0!");
    expect(r[0][2]).toBe(0.5);
  });

  it("accepts a 1-D text list (widened to a single row)", () => {
    const n = new MapTableNode({ expr: "UPPER(x)", resultAs: "text" });
    expect(n.data({ table: [["a", "b"]] }).result).toEqual([["A", "B"]]);
  });

  it("runs a wired text LAMBDA over the cells", () => {
    const lam = new LambdaNode({ params: "s", expr: "LOWER(s)" }).data({}).result;
    const n = new MapTableNode({ resultAs: "text" });
    expect(n.data({ table: [[["A", "B"]]], lambda: [lam] }).result).toEqual([["a", "b"]]);
  });
});

describe("BYROW / REDUCE / MAKEARRAY — text", () => {
  it("BYROW joins each row to a string", () => {
    const n = new ByAxisNode({ expr: 'TEXTJOIN(",", FALSE, v)', resultAs: "text" });
    expect(n.data({ table: [[["a", "b"], ["c", "d"]]] }).result).toEqual(["a,b", "c,d"]);
  });

  it("BYROW output socket is the text combo", () => {
    expect(dt(new ByAxisNode({ resultAs: "text" }).outputs.result?.socket)).toBe("strcombo");
  });

  it("REDUCE concatenates from a wired text initial", () => {
    const n = new ReduceLambdaNode({ expr: "acc & x", resultAs: "text" });
    expect(n.data({ initial: [""], table: [[["a", "b", "c"]]] }).result).toBe("abc");
  });

  it("REDUCE output socket is a scalar string", () => {
    expect(dt(new ReduceLambdaNode({ resultAs: "text" }).outputs.result?.socket)).toBe("string");
    expect(dt(new ReduceLambdaNode({ resultAs: "number" }).outputs.result?.socket)).toBe("number");
  });

  it("MAKEARRAY can build a text grid", () => {
    const n = new MakeArrayNode({ expr: '"cell " & r & "," & c', resultAs: "text" });
    expect(n.data({ rows: [2], cols: [2] }).result).toEqual([
      ["cell 1,1", "cell 1,2"],
      ["cell 2,1", "cell 2,2"],
    ]);
  });
});
