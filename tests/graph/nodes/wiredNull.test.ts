import { describe, it, expect } from "vitest";
import { ConcatNode } from "../../../src/graph/nodes/text";
import { BooleanOpNode, NotNode, IfsNode } from "../../../src/graph/nodes/logic";
import { RandBetweenNode } from "../../../src/graph/nodes/display";
import { CableSwitchNode } from "../../../src/graph/nodes/control";
import { DepreciationNode } from "../../../src/graph/nodes/finance";
import { ColumnsNode } from "../../../src/graph/nodes/frame";
import { GaugeNode } from "../../../src/graph/nodes/visual";
import { AlertNode } from "../../../src/graph/nodes/display";
import { DistributionsNode } from "../../../src/graph/nodes/distribution";
import { throughBoundary } from "../boundaryKit";
import { extractInit } from "../../../src/graph/nodeInit";
import type { FrameValue } from "../../../src/graph/frame";
import { FormatDollarNode, FixedNode } from "../../../src/graph/nodes/text";
import { TwoInputMathNode } from "../../../src/graph/nodes/scalar";
import { compileEvaluator } from "../../../src/graph/excelFormula";

// [[D86]] blankRoles, [[value-semantics#Reading an input]], [[input-roles#What each input kind does today]]

describe("reducers SKIP a missing rather than propagating it", () => {

  it("CONCAT: a wired blank contributes nothing, and does not fall back to its box", () => {
    const node = new ConcatNode();
    const keys = Object.keys(node.inputs);
    node.stringLiterals[keys[0]] = "xx";
    const inputs: Record<string, string[] | undefined> = {};
    inputs[keys[0]] = [null as unknown as string];
    inputs[keys[1]] = ["b"];
    expect(node.data(inputs).result).toBe("b");
  });

});

describe("figure sinks — empty figure for a datum, neutral default for styling", () => {
  it("Gauge (Bar style): value and target go blank, but the track's scale keeps the card's bound", () => {
    const node = new GaugeNode({ mode: "bar" });
    node.literals.value = 42;
    node.literals.target = 80;
    node.literals.max = 250;
    const out = node.data({
      value: [null as unknown as number],
      target: [null as unknown as number],
      max: [null as unknown as number],
    }).chart;
    const p = out.payload as { value: number | null; target: number | null; max: number };
    expect(p.value).toBeNull();
    expect(p.target).toBeNull();

    expect(p.max).toBe(250);
  });

});

describe("Kleene logic THROUGH the real coercion wrapper", () => {

  function wrapped<T extends { data: (i: never) => unknown }>(node: T): T {
    throughBoundary(node as never);
    return node;
  }

  it("AND(false, true) is FALSE through coercion — wired as numbers AND as booleans", () => {

    const node = wrapped(new BooleanOpNode({ op: "and" }));
    const [a, b] = Object.keys(node.inputs);
    expect((node.data({ [a]: [0], [b]: [1] }) as { result: unknown }).result).toBe(false);
    expect((node.data({ [a]: [false], [b]: [true] } as never) as { result: unknown }).result).toBe(false);
  });

  it("NOT(false) is TRUE through coercion", () => {
    const node = wrapped(new NotNode());
    expect((node.data({ in: [0] }) as { result: unknown }).result).toBe(true);
  });

  it("a wired blank still reads as unknown through coercion", () => {
    const node = wrapped(new BooleanOpNode({ op: "and" }));
    const [a, b] = Object.keys(node.inputs);
    expect((node.data({ [a]: [null], [b]: [1] }) as { result: unknown }).result).toBeNull();
  });
});

describe("a CHECK never fires against a bound the graph withheld", () => {
  it("Alert (range): a wired blank High is unknown — status null, not the card's 100", () => {
    const node = new AlertNode({ condition: "range" });
    node.literals.high = 100;
    expect(node.data({ value: [500], high: [null as unknown as number] }).result).toBeNull();
    // Unwired High keeps the card's bound and still alerts.
    const unwired = new AlertNode({ condition: "range" });
    expect(unwired.data({ value: [500] }).result).toBe(2);
  });

});

describe("a column-LIST reference — same rule as the scalar column", () => {
  const f: FrameValue = { __frame: true, columns: [{ name: "a", type: "number", values: [1] }, { name: "b", type: "number", values: [2] }] };

  it("Columns (Keep): a name the frame lacks is a #REF! error", async () => {
    await expect(Promise.resolve().then(() => new ColumnsNode().data({ frame: [f], columns: [["nope"]] }))).rejects.toMatchObject({ code: "#REF!" });
  });

  it("Columns: op round-trips through extractInit", () => {
    expect(extractInit(new ColumnsNode({ op: "drop" })).op).toBe("drop");
    expect(extractInit(new ColumnsNode()).op).toBe("keep");
  });
});

describe("value selectors — an unknown selector is an unknown answer", () => {
  it("IFS: a WIRED blank condition propagates; an unset row just falls through", () => {
    const wired = new IfsNode();
    wired.literals.otherwise = 7;
    expect(wired.data({ cond0: [null] }).result).toBeNull();
    // Unset rows (nothing wired, nothing typed) fall through to Otherwise.
    const unset = new IfsNode();
    unset.literals = { otherwise: 7 }; // clear the demo-seeded pair literals
    expect(unset.data({}).result).toBe(7);
  });

});

describe("Distribution — a wired blank parameter propagates", () => {

  it("NORM.DIST: a wired blank mean blanks the result; unwired uses the literals", () => {
    const node = new DistributionsNode({ op: "normal", form: "cdf" });
    const firstKey = node.spec.xKey;
    expect(node.data({ [firstKey]: [0], mean: [null] }).result).toBeNull();
    expect(typeof node.data({}).result).toBe("number");
  });
});

describe("Input family — wired blank by role", () => {

  it("RAND: a wired blank bound propagates; unwired draws from the card range", () => {
    const node = new RandBetweenNode();
    node.literals.bound1 = 0;
    node.literals.bound2 = 10;
    expect(node.data({ bound1: [null as unknown as number] }).result).toBeNull();
    expect(typeof node.data({}).result).toBe("number");
  });

  it("Input Switch: a blank on the active input routes through as blank", () => {
    const node = new CableSwitchNode({ activeIndex: 0 });
    const [v0] = Object.keys(node.inputs);
    expect(node.data({ [v0]: [null] }).out).toBeNull();
    expect(node.data({ [v0]: [42] }).out).toBe(42);
  });
});

describe("cards agree with their formula twin on a blank setting", () => {
  const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
  const blank = [null as unknown as number];

  it("DDB and VDB: a blank factor is the default 2", () => {
    const ddb = new DepreciationNode({ op: "ddb" });
    ddb.literals.factor = 3;
    expect(ddb.data({ cost: [1000], salvage: [100], life: [5], per: [1], factor: blank }).result).toBe(ev("DDB(1000, 100, 5, 1, f)", { f: null }));
    expect(ev("DDB(1000, 100, 5, 1, f)", { f: null })).toBe(ev("DDB(1000, 100, 5, 1)"));
    const vdb = new DepreciationNode({ op: "vdb" });
    vdb.literals.factor = 3;
    expect(vdb.data({ cost: [1000], salvage: [100], life: [5], start: [0], end: [1], factor: blank }).result).toBe(ev("VDB(1000, 100, 5, 0, 1, f)", { f: null }));
  });

  it("DOLLAR and FIXED: a blank decimals is the default 2, item by item in a list", () => {
    const d = new FormatDollarNode();
    d.literals.decimals = 0;
    expect(d.data({ number: [1234.567], decimals: blank }).result).toBe(ev("DOLLAR(1234.567, d)", { d: null }));
    const f = new FixedNode();
    expect(f.data({ number: [1234.567], decimals: [[0, null] as unknown as number] }).result).toEqual([ev("FIXED(1234.567, 0)"), ev("FIXED(1234.567)")]);
  });

  it("LOG's base and GESTEP's step are settings; B stays data under the other ops", () => {
    const log = new TwoInputMathNode({ op: "log" });
    log.literals.b = 2;
    expect(log.data({ a: [100], b: blank }).result).toBe(ev("LOG(100, b)", { b: null }));
    expect(log.data({ a: [100], b: blank }).result).toBeCloseTo(2);
    const ge = new TwoInputMathNode({ op: "gestep" });
    expect(ge.data({ a: [0.5], b: blank }).result).toBe(ev("GESTEP(0.5, s)", { s: null }));
    expect(new TwoInputMathNode({ op: "hypot" }).data({ a: [3], b: blank }).result).toBeNull();
  });
});

