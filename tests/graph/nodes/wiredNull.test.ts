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

// ─── A wired blank must not resurrect the typed literal ───────────────────────
// The `inputs.x?.[0] ?? this.literals.x` idiom swallows a WIRED null into the
// literal, so a blank flowing down a cable silently became whatever value sat in
// the node's own box. Under the settled P6 model a missing value PROPAGATES —
// null in, null out — and Fill/Coalesce is the opt-in recovery.
//
// The contract has two halves and both matter: a CONNECTED cable wins even when
// its value is null, and only an UNWIRED slot falls back to the literal. Tests
// come in pairs for that reason — a fix that propagated unconditionally would
// break every node's typed default just as badly.
//
// A wired input arrives as `[null]` (the slot is connected, the value is missing);
// an unwired one arrives as `undefined`.

// [[D86]] blankRoles: a blank setting is its default, or #SYNTAX! when it has none; data blanks stay blank.



describe("reducers SKIP a missing rather than propagating it", () => {
  // The other half of the value model: an aggregator skips nulls (SUM does), while
  // element-wise math propagates them. CONCAT is a reducer, so a missing input
  // contributes nothing to the join — but it still must not resurrect the literal.
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
    // The figure still has to render, so the SCALE behaves like a Slider bound.
    expect(p.max).toBe(250);
  });


});



// ─── The review sweep's second pass (2026-07-28) — misses the first pass left ──

describe("Kleene logic THROUGH the real coercion wrapper", () => {
  // The bare-data() tests above pass raw numbers, but the live engine coerces a
  // wired logical to a REAL boolean first (`numsToBools`), and `false !== 0` is
  // true — so AND(false, TRUE) computed as AND(true, true). These pin the family
  // through the input boundary, the call the engine makes.
  function wrapped<T extends { data: (i: never) => unknown }>(node: T): T {
    throughBoundary(node as never);
    return node;
  }

  it("AND(false, true) is FALSE through coercion — wired as numbers AND as booleans", () => {
    // The numbers wiring is the pre-fix control; the booleans wiring is the
    // regression (`false !== 0` made AND(false, TRUE) compute as AND(true, true)).
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
  // The [[B11]] maximalMerge flagship: every param reads through readInput, so a wired
  // blank mean blanks the result while an unwired slot uses the seeded literal.
  it("NORM.DIST: a wired blank mean blanks the result; unwired uses the literals", () => {
    const node = new DistributionsNode({ op: "normal", form: "cdf" });
    const firstKey = node.spec.xKey;
    expect(node.data({ [firstKey]: [0], mean: [null] }).result).toBeNull();
    expect(typeof node.data({}).result).toBe("number");
  });
});



describe("Input family — wired blank by role", () => {
  // Color A/B are operands: a wired blank propagates (blank out), it is NOT the
  // "isn't a color" #VALUE! that a typed-empty card gives.

  // COMPLEX's parts are operands — a blank real/imag makes the number unknown.

  // RandBetween's bounds are the range's shape — a blank bound has no range to draw from.
  it("RAND: a wired blank bound propagates; unwired draws from the card range", () => {
    const node = new RandBetweenNode();
    node.literals.bound1 = 0;
    node.literals.bound2 = 10;
    expect(node.data({ bound1: [null as unknown as number] }).result).toBeNull();
    expect(typeof node.data({}).result).toBe("number");
  });

  // The Input Switch is a relay with no card literal: a wired blank routes through as blank.
  it("Input Switch: a blank on the active input routes through as blank", () => {
    const node = new CableSwitchNode({ activeIndex: 0 });
    const [v0] = Object.keys(node.inputs);
    expect(node.data({ [v0]: [null] }).out).toBeNull();
    expect(node.data({ [v0]: [42] }).out).toBe(42);
  });
});














// [[D86]] blankRoles: a card with a formula twin reads a blank setting as the twin does, so a wired blank on the card
// and a blank argument in the formula agree.
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

