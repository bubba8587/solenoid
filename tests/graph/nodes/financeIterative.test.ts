// [[C17]] shareImpl, [[formula-language#Finance kernels]], [[formula-language#Finance]]
import { describe, it, expect } from "vitest";
import { dated } from "../datedInputs";
import { solDate } from "../../../src/graph/dateValue";
import { NPVNode, IRRNode, MirrNode } from "../../../src/graph/nodes/finance";
import { parseDateToSerial } from "../../../src/graph/nodes/date";
import { compileEvaluator } from "../../../src/graph/excelFormula";
import { isSolError } from "../../../src/graph/errorValue";

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);

const flows = [-1000, 300, 400, 500, 200];

describe("IRR / XIRR / NPV / MIRR formulas agree with their nodes", () => {
  const d = (s: string) => parseDateToSerial(s);
  const dates = [d("2020-01-01"), d("2020-06-01"), d("2021-01-01"), d("2021-06-01"), d("2022-01-01")];

  it.each([
    [[-4943, -2458, 285]],
    [[45, 4730, -325]],
    [[-1688, -3813, 432]],
    [flows],
  ])("IRR(%j) is the node's root", (cf) => {
    const node = new IRRNode().data({ list: [cf as number[]] }).result as number;
    expect(ev("IRR(c)", { c: cf })).toBeCloseTo(node, 12);
    expect(ev("IRR(c, 0.2)", { c: cf })).toBeCloseTo(node, 12); // guess accepted, ignored
  });
  it("XIRR formula is the node's dated root", () => {
    const node = new IRRNode({ op: "dates" }).data(dated({ list: [flows], dates: [dates] })).result as number;
    expect(ev("XIRR(c, d)", { c: flows, d: dates.map(solDate) })).toBeCloseTo(node, 12);
  });
  it("a same-sign series is #CONV! on both surfaces; too few points is blank", () => {
    const r = ev("IRR(c)", { c: [100, 200, 300] });
    expect(isSolError(r) && r.code).toBe("#CONV!");
    expect(ev("IRR(c)", { c: [100] })).toBeNull();
  });
  it("a blank cash flow is a ZERO period on both surfaces, never a dropped one", () => {
    const cf = [-100, null, 60, 60];
    expect(ev("IRR(c)", { c: cf })).toBeCloseTo(new IRRNode().data({ list: [cf] }).result as number, 12);
    expect(ev("NPV(0.1, c)", { c: cf })).toBeCloseTo(new NPVNode().data({ list: [cf], rate: [0.1] }).result as number, 12);
    expect(ev("MIRR(c, 0.1, 0.12)", { c: cf })).toBeCloseTo(
      new MirrNode().data({ list: [cf], finrate: [0.1], reinrate: [0.12] }).result as number, 12);
  });
  it("MIRR formula == node, incl. the same-sign #DIV/0!", () => {
    const cf = [-120000, 39000, 30000, 21000, 37000, 46000];
    expect(ev("MIRR(c, 0.1, 0.12)", { c: cf })).toBeCloseTo(new MirrNode().data({ list: [cf], finrate: [0.1], reinrate: [0.12] }).result as number, 12);
    expect(ev("MIRR(c, 0.1, 0.12)", { c: cf })).toBeCloseTo(0.1260941303659051, 10); // Excel's documented example
    const r = ev("MIRR(c, 0.1, 0.12)", { c: [100, 200] });
    expect(isSolError(r) && r.code).toBe("#DIV/0!");
  });
  it("a blank DATE makes XIRR blank on both surfaces (the schedule is unknown)", () => {
    const ds = [dates[0], null, dates[2], dates[3], dates[4]];
    expect(ev("XIRR(c, d)", { c: flows, d: ds.map((x) => (x === null ? null : solDate(x))) })).toBeNull();
    expect(new IRRNode({ op: "dates" }).data(dated({ list: [flows], dates: [ds as number[]] })).result).toBeNull();
  });
});
