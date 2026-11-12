import { describe, it, expect } from "vitest";
import { ExpressionNode } from "../../../src/graph/nodes/expression";
import { EquationNode } from "../../../src/graph/nodes/equation";
import { MapTableNode, ByAxisNode, ReduceLambdaNode, MakeArrayNode } from "../../../src/graph/nodes/tableLambda";
import { LambdaNode, isLambdaValue } from "../../../src/graph/nodes/lambda";
import { SolenoidSocket, type SocketDataType } from "../../../src/graph/sockets";

// Polyform: the formula producers loop ANY Excel function over arrays of any
// element type, declaring their output element type with a result selector that
// swaps the output socket at the node's dimensionality. Numeric behavior is
// unchanged (see expression / tableLambda existing suites); these tests cover
// text + date results, the socket swap, and that the engine stays polymorphic.

const dt = (socket: unknown): SocketDataType | undefined =>
  socket instanceof SolenoidSocket ? socket.dataType : undefined;

describe("Expression — value-polymorphic results", () => {














  it("passes a scalar boolean comparison through (audit finding 27)", () => {
    // Comparisons return a real logical now — display renders TRUE/FALSE and
    // the logical↔number bridge covers numeric consumers.
    const n = new ExpressionNode({ expr: "a > b" });
    expect(n.data({ a: [5], b: [3] }).result).toBe(true);
  });

  it("an InlineCast types the output socket as its cast; ∅ waits for the run ([[socket-lattice#The InlineCast]])", () => {
    expect(dt(new ExpressionNode({ castTo: "number" }).outputs.result?.socket)).toBe("numlist");
    expect(dt(new ExpressionNode({ castTo: "text" }).outputs.result?.socket)).toBe("strcombo");
    expect(dt(new ExpressionNode({ castTo: "date" }).outputs.result?.socket)).toBe("datecombo");
    expect(dt(new ExpressionNode({ castTo: "logical" }).outputs.result?.socket)).toBe("logicalcombo");
    // anyCOMBO, not `any`: an uncast result IS a list whenever a list variable broadcasts.
    expect(dt(new ExpressionNode().outputs.result?.socket)).toBe("anycombo");
  });

  it("the 2-D producers: uncast, the default, is anytable until a run names the family (wildcardLadder)", () => {
    expect(dt(new MapTableNode().outputs.result?.socket)).toBe("anytable");
    expect(dt(new MakeArrayNode().outputs.result?.socket)).toBe("anytable");
  });

  it("variable inputs are `anydata` so text/date arrays AND matrices connect, and a scalar stays scalar", () => {
    const n = new ExpressionNode({ expr: "UPPER(name)", castTo: "text" });
    // `anydata` ([[C15]] matricesInFormulas/[[C10]] socketLattice) replaced `anycombo`, which had replaced `anylist` + the `noWidenInputs` side-channel:
    // same acceptance, but the SOCKET now says the evaluator takes either rank.
    expect(dt(n.inputs.name?.socket)).toBe("anydata");
  });
});

describe("MAP — text & date matrices", () => {


  it("output socket follows the InlineCast (matrix level)", () => {
    expect(dt(new MapTableNode({ castTo: "number" }).outputs.result?.socket)).toBe("table");
    expect(dt(new MapTableNode({ castTo: "text" }).outputs.result?.socket)).toBe("strtable");
    expect(dt(new MapTableNode({ castTo: "date" }).outputs.result?.socket)).toBe("datetable");
  });

  it("value inputs are the 2-D `anytable` (a 1-D list widens in)", () => {
    const n = new MapTableNode();
    expect(dt(n.inputs.table?.socket)).toBe("anytable");
    expect(dt(n.inputs.table2?.socket)).toBe("anytable");
  });



});

describe("BYROW / REDUCE / MAKEARRAY — text", () => {

  // [[D85]] columnsStayColumns: BYROW answers a one-column table, BYCOL a list.
  it("BYROW's output socket is the text table, BYCOL's the text combo, and the switch retypes it", () => {
    const n = new ByAxisNode({ castTo: "text" });
    expect(dt(n.outputs.result?.socket)).toBe("strtable");
    expect(dt(new ByAxisNode({ castTo: "text", op: "col" }).outputs.result?.socket)).toBe("strcombo");
    expect(n.setOp("col")).toBe(true);
    expect(dt(n.outputs.result?.socket)).toBe("strcombo");
    expect(n.outputs.result?.label).toBe("Per column");
  });


  it("REDUCE output socket is a scalar string", () => {
    expect(dt(new ReduceLambdaNode({ castTo: "text" }).outputs.result?.socket)).toBe("string");
    expect(dt(new ReduceLambdaNode({ castTo: "number" }).outputs.result?.socket)).toBe("number");
  });

});

describe("per-variable descriptions (Expression + Equation)", () => {
  it("round-trip through init, and stay OUT of the formula string", () => {
    const e = new ExpressionNode({ expr: "rate * hours", varDescriptions: { rate: "Hourly rate ($)", hours: "Hours worked" } });
    expect(e.varDescriptions.rate).toBe("Hourly rate ($)");
    expect(e.expr).toBe("rate * hours"); // formula untouched — KaTeX never sees the prose
    expect(e.varNames).toEqual(["rate", "hours"]);
  });

  it("the Equation node carries them too", () => {
    const q = new EquationNode({ expr: "v = i * r", varDescriptions: { v: "Voltage (V)", i: "Current (A)", r: "Resistance (Ω)" } });
    expect(q.varDescriptions.r).toBe("Resistance (Ω)");
  });

  it("Lambda carries them + surfaces them on its VALUE for the Report legend", () => {
    const l = new LambdaNode({ params: "x, y", expr: "x * y", varDescriptions: { x: "width", y: "height" } });
    // varNames spans params + captured, so extractInit filters correctly.
    expect(l.varNames).toContain("x");
    expect(l.varNames).toContain("y");
    const out = l.data({});
    // The value carries the descriptions so a Report embed can show "where:".
    expect(isLambdaValue(out.result) && out.result.descriptions).toEqual({ x: "width", y: "height" });
    // A description-less lambda leaves the value's field undefined (kept small).
    const bare = new LambdaNode({ params: "x", expr: "x + 1" });
    expect(isLambdaValue(bare.data({}).result) && (bare.data({}).result as { descriptions?: unknown }).descriptions).toBeUndefined();
  });
});

