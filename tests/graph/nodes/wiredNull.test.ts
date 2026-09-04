import { describe, it, expect } from "vitest";
import { TextTransformNode, TextSliceNode, ReptNode, TextSplitNode, ConcatNode, RegexNode } from "../../../src/graph/nodes/text";
import { DateConstructNode, DateAddNode, WorkdaysNode, DateDiffNode } from "../../../src/graph/nodes/date";
import { BooleanOpNode, NotNode, IfsNode, SwitchNode, IfNode, IsTestNode } from "../../../src/graph/nodes/logic";
import { SliderInputNode, ColorBlendNode } from "../../../src/graph/nodes/input";
import { RandBetweenNode } from "../../../src/graph/nodes/display";
import { ComplexFromNode, QuadraticRootsNode } from "../../../src/graph/nodes/complex";
import { CableSwitchNode } from "../../../src/graph/nodes/control";
import { ExpressionNode } from "../../../src/graph/nodes/expression";
import { ClampNode, ArithmeticNode, MathFnNode, MRoundNode, CombinatoricsNode } from "../../../src/graph/nodes/scalar";
import { MirrNode, DiscountSecurityNode, IrrNode, OddCouponNode, NpvNode, DepreciationNode } from "../../../src/graph/nodes/finance";
import { SortFrameNode, JoinNode, HeadNode, ColumnsNode, XLookupNode } from "../../../src/graph/nodes/frame";
import { ListIndexNode, SliceNode, FilterNode, SeriesNode, AggregateNode } from "../../../src/graph/nodes/list";
import { GaugeNode, KpiNode, HistogramNode } from "../../../src/graph/nodes/visual";
import { AlertNode } from "../../../src/graph/nodes/display";
import { ExpectNode } from "../../../src/graph/nodes/quality";
import { CubeRollupNode, BuildCubeNode } from "../../../src/graph/nodes/cube";
import { CastNode } from "../../../src/graph/nodes/cast";
import { ConvertNode } from "../../../src/graph/nodes/convert";
import { ColebrookNode } from "../../../src/graph/nodes/fluids";
import { HypothesisTestNode, RankPercentileNode } from "../../../src/graph/nodes/stats";
import { DistributionNode } from "../../../src/graph/nodes/distribution";
import { SetCellNode, TableMultNode } from "../../../src/graph/nodes/matrix";
import { MakeArrayNode } from "../../../src/graph/nodes/tableLambda";
import { wrapNodeData } from "../../../src/graph/coerceInputs";
import { readFrame } from "../../../src/graph/frameBackend";
import { extractInit } from "../../../src/graph/copyPaste";
import type { FrameValue } from "../../../src/graph/frame";
import { solError, isSolError } from "../../../src/graph/errorValue";

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

describe("text operands", () => {
  it("UPPER: a wired blank yields blank, not the text typed in the box", () => {
    const node = new TextTransformNode({ op: "upper" });
    node.stringLiterals.text = "abc";
    // The originally reported case: this returned "ABC".
    expect(node.data({ text: [null as unknown as string] }).result).toBeNull();
  });

  it("UPPER: an UNWIRED slot still uses the typed text", () => {
    const node = new TextTransformNode({ op: "upper" });
    node.stringLiterals.text = "abc";
    expect(node.data({}).result).toBe("ABC");
  });

  it("LEFT: a wired blank COUNT propagates rather than falling back to 1", () => {
    const node = new TextSliceNode({ op: "left" });
    node.literals.n = 3;
    expect(node.data({ text: ["abcdef"], n: [null as unknown as number] }).result).toBeNull();
    // Unwired count keeps the literal.
    expect(node.data({ text: ["abcdef"] }).result).toBe("abc");
  });

  it("propagates per CELL, so one blank in a list doesn't poison its neighbours", () => {
    const node = new TextTransformNode({ op: "upper" });
    expect(node.data({ text: [["a", null as unknown as string, "c"]] }).result)
      .toEqual(["A", null, "C"]);
  });

  it("REPT: a wired blank count propagates", () => {
    const node = new ReptNode();
    node.literals.times = 2;
    expect(node.data({ text: ["ab"], times: [null as unknown as number] }).result).toBeNull();
    expect(node.data({ text: ["ab"] }).result).toBe("abab");
  });
});

describe("mode selectors — the project's model, not Excel's", () => {
  // The real choice here: a wired blank could mean "the mode is unknown, so the
  // answer is unknown" (this app's P6 model) or "nothing supplied, use the default"
  // (Excel's reading of an omitted optional argument). Author call: follow THIS
  // project. A blank you deliberately wired is not silently reinterpreted.
  it("TEXTSPLIT: a wired blank delimiter yields blank, not a character split", () => {
    const node = new TextSplitNode();
    node.stringLiterals.delimiter = ",";
    expect(node.data({ text: ["a,b"], delimiter: [null as unknown as string] }).result).toBeNull();
    // Unwired keeps the typed delimiter.
    expect(node.data({ text: ["a,b"] }).result).toEqual(["a", "b"]);
  });

  it("NETWORKDAYS: a wired blank weekend code yields blank, not the default week", () => {
    const node = new WorkdaysNode({ op: "networkdays" });
    expect(node.data({
      start: [46096], end: [46196], weekend_code: [null as unknown as number],
    }).result).toBeNull();
    expect(typeof node.data({ start: [46096], end: [46196] }).result).toBe("number");
  });
});

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

  it("Aggregate: SUM skips a null cell, one error propagates, COUNTBLANK counts the blanks", () => {
    const sum = new AggregateNode({ op: "sum" });
    expect(sum.data({ list: [[1, null, 3]] }).result).toBe(4); // skipped, not zeroed
    const err = solError("#DIV/0!", "divide by zero");
    expect(isSolError(sum.data({ list: [[1, err, 3]] }).result)).toBe(true);
    const blanks = new AggregateNode({ op: "countblank" });
    expect(blanks.data({ list: [[1, null, 3, null]] }).result).toBe(2);
  });
});

describe("Logic — unwired-vs-wired-blank and blank conditions", () => {
  // ISBLANK is the sharpest case: an UNWIRED slot has nothing to test (blank result),
  // while a WIRED blank is a real missing cell (TRUE).
  it("ISBLANK: unwired is blank (nothing to test); a wired blank is TRUE", () => {
    const node = new IsTestNode({ op: "isblank" });
    expect(node.data({}).result).toBeNull();
    expect(node.data({ value: [null] }).result).toBe(true);
  });

  // IF cannot pick a branch from an unknown condition.
  it("IF: a wired blank condition gives a blank result; a real condition selects", () => {
    const node = new IfNode();
    expect(node.data({ cond: [null], then: [1], else: [2] }).result).toBeNull();
    expect(node.data({ cond: [true], then: [1], else: [2] }).result).toBe(1);
  });
});

describe("Kleene logic — a wired blank is UNKNOWN, not FALSE", () => {
  // The Kleene truth tables themselves (AND/OR/NOT over null operands) are pinned
  // in logic.test.ts and valueKinds.test.ts (kleeneLogic); this sweep keeps only
  // its own charter's half: unwired still falls back to the card literal.
  it("NOT unwired still uses the literal; only a WIRED blank is unknown", () => {
    const node = new NotNode();
    expect(node.data({}).result).toBe(true); // NOT(0) — the default literal
    expect(node.data({ in: [null] }).result).toBeNull();
  });
});

describe("a CONTROL needs a usable bound — Slider keeps the card's", () => {
  // The one case in this sweep where falling back to the literal is RIGHT. A Slider
  // is a source whose control cannot exist without finite bounds, so a wired blank
  // bound honours the value printed on the card. Both alternatives are worse:
  // propagating null drops the value the user set, and "stop constraining"
  // (±Infinity) breaks the range input, the play loop's wrap, and tornado's sweep.
  it("bounds stay FINITE when a wired bound is blank", () => {
    const node = new SliderInputNode();
    node.literals.min = 0;
    node.literals.max = 100;
    node.data({ max: [null as unknown as number], min: [null as unknown as number] });
    expect(Number.isFinite(node.effectiveMin)).toBe(true);
    expect(Number.isFinite(node.effectiveMax)).toBe(true);
    expect(node.effectiveMax).toBe(100);
  });

  it("still emits its value, and still clamps to the card's bound", () => {
    const node = new SliderInputNode();
    node.literals.max = 100;
    node.value = 250;
    expect(node.data({ max: [null as unknown as number] }).value).toBe(100);
  });

  it("a WIRED bound still wins over the card's", () => {
    const node = new SliderInputNode();
    node.literals.max = 100;
    node.value = 250;
    expect(node.data({ max: [500] }).value).toBe(250);
  });
});

describe("a formula VARIABLE carries the blank through", () => {
  it("=x+1 with a wired blank x is blank, not 1", () => {
    const node = new ExpressionNode({ expr: "x + 1" });
    node.literals.x = 5;
    expect(node.data({ x: [null as unknown as number] }).result).toBeNull();
    // Unwired still uses the typed value.
    expect(node.data({}).result).toBe(6);
  });
});

describe("\"absent\" is not \"unknown\" — the optional-input trap", () => {
  // Clamp already uses null internally for "no bound applied", so the wired blank
  // had a ready-made path to fall into that silently means "don't clamp". Only the
  // UNWIRED slot means omitted.
  it("Clamp: an UNWIRED min means no floor", () => {
    const node = new ClampNode();
    node.literals.value = -5;
    node.literals.max = 10;
    expect(node.data({ value: [-5] }).result).toBe(-5); // no floor applied
  });

  it("Clamp: a WIRED blank min is unknown, not unclamped", () => {
    const node = new ClampNode();
    expect(node.data({ value: [-5], min: [null as unknown as number] }).result).toBeNull();
  });

  it("Clamp: a WIRED min still clamps", () => {
    const node = new ClampNode();
    expect(node.data({ value: [-5], min: [0] }).result).toBe(0);
  });
});

describe("NPV — a positional list blanks to zero, the rate operand propagates", () => {
  // A cash-flow list is POSITIONAL: a blank cell counts as 0 (holds its period) rather
  // than being skipped like an aggregate. The rate is an operand and propagates.
  it("a blank cash flow counts as zero; a wired blank rate blanks the result", () => {
    const node = new NpvNode();
    node.literals.rate = 0.1;
    expect(node.data({ rate: [null as unknown as number], list: [[100, 200]] }).result).toBeNull();
    const withBlank = node.data({ list: [[100, null, 300]] }).result;
    const withZero = node.data({ list: [[100, 0, 300]] }).result;
    expect(withBlank).toBeCloseTo(withZero as number);
  });
});

describe("Depreciation — the active-op guard scopes to the inputs the op reads", () => {
  // SLN never reads `per` (it returns before the per-check), so a wired blank per must
  // not blank it; SYD reads per and blanks on a wired blank.
  it("SLN ignores a wired blank per; SYD blanks on it", () => {
    const sln = new DepreciationNode({ op: "sln" });
    expect(sln.data({ cost: [1000], salvage: [100], life: [5], per: [null as unknown as number] }).result).toBe(180);
    const syd = new DepreciationNode({ op: "syd" });
    expect(syd.data({ cost: [1000], salvage: [100], life: [5], per: [null as unknown as number] }).result).toBeNull();
  });
});

describe("where the blank check GOES", () => {
  // Both of these typecheck and take the RIGHT disposition — in the wrong place.
  it("an error outranks an unknown: MIRR reports the error, not blank", () => {
    const node = new MirrNode();
    node.literals.finrate = 0.1;
    const err = solError("#DIV/0!", "divide by zero");
    const out = node.data({
      list: [[100, err, -50]],
      finrate: [null as unknown as number],
    }).result;
    expect(isSolError(out), `expected the error to win, got ${String(out)}`).toBe(true);
  });

  it("the guard is scoped to the ACTIVE op: TBILLYIELD ignores a blank discount", () => {
    // `discount` belongs to TBILLEQ/TBILLPRICE. A guard hoisted above the switch would
    // have nulled this, because it ANDs together inputs this op never reads.
    const node = new DiscountSecurityNode({ op: "tbillyield" });
    node.literals.pr = 97.5;
    const out = node.data({
      settle: [46096], maturity: [46187], discount: [null as unknown as number],
    }).result;
    expect(typeof out).toBe("number");
    // Its OWN input still propagates.
    expect(node.data({
      settle: [46096], maturity: [46187], pr: [null as unknown as number],
    }).result).toBeNull();
  });
});

describe("a column REFERENCE — the frame family's dominant shape", () => {
  // Nearly every frame verb names its column with a string that is BOTH a socket and
  // a card field, and the empty literal already means something: "no column chosen —
  // pass the frame through". A wired blank is not that. It says the graph computed
  // which column to act on and got nothing, so the output frame is blank.
  it("Frame Sort: a WIRED blank column blanks the frame, an empty literal passes it through", async () => {
    const f: FrameValue = { __frame: true, columns: [{ name: "a", type: "number", values: [2, 1] }] };
    const wired = new SortFrameNode();
    expect((await wired.data({ frame: [f], column: [null as unknown as string] })).frame).toBeNull();
    // Unwired, with the literal left empty — the "not chosen yet" reading, unchanged.
    expect((await new SortFrameNode().data({ frame: [f] })).frame).toEqual(f);
  });

  it("Join: a WIRED blank rightKey is unknown, not \"same name as the left\"", async () => {
    const l: FrameValue = { __frame: true, columns: [{ name: "id", type: "number", values: [1] }] };
    const r: FrameValue = { __frame: true, columns: [{ name: "id", type: "number", values: [1] }] };
    const node = new JoinNode();
    node.stringLiterals.leftKey = "id";
    expect((await node.data({
      left: [l], right: [r], rightKey: [null as unknown as string],
    })).frame).toBeNull();
    // UNWIRED rightKey still falls back to the left key and joins.
    const unwired = new JoinNode();
    unwired.stringLiterals.leftKey = "id";
    expect((await unwired.data({ left: [l], right: [r] })).frame).not.toBeNull();
  });
});

describe("XLOOKUP — column refs propagate, a non-table is #VALUE!", () => {
  const table: FrameValue = { __frame: true, columns: [
    { name: "k", type: "string", values: ["a", "b"] },
    { name: "v", type: "number", values: [1, 2] },
  ] };
  it("a wired blank In column blanks the result; unwired uses the literal", () => {
    const node = new XLookupNode();
    node.stringLiterals.inColumn = "k";
    node.stringLiterals.returnColumn = "v";
    expect(node.data({ frame: [table], lookup: ["a"], inColumn: [null as unknown as string] }).value).toBeNull();
    expect(node.data({ frame: [table], lookup: ["a"] }).value).toBe(1);
  });
  it("a scalar source (not a table) is #VALUE!, never a silent blank", () => {
    const node = new XLookupNode();
    node.stringLiterals.inColumn = "k";
    node.stringLiterals.returnColumn = "v";
    expect(isSolError(node.data({ frame: [5], lookup: ["a"] }).value)).toBe(true);
  });
});

describe("the THIRD state — undefined is omitted, null is unknown", () => {
  // Excel's omitted-argument readings are real and stay. They just belong to the
  // `undefined` branch, which readInput hands back only for an unwired slot with
  // nothing typed. A `?? 0` on the literal would collapse the two.
  it("INDEX: an omitted axis is the WHOLE axis; a wired blank axis is unknown", () => {
    const m = [[1, 2], [3, 4]];
    // Omitted column → the whole row (Excel INDEX).
    expect(new ListIndexNode().data({ list: [m], index: [1] }).result).toEqual([1, 2]);
    // A cable carrying blank is not an omission.
    expect(new ListIndexNode().data({
      list: [m], index: [1], column: [null as unknown as number],
    }).result).toBeNull();
  });

  it("Slice: an omitted end runs to the end; a wired blank end is unknown", () => {
    const arr = [1, 2, 3, 4];
    expect(new SliceNode().data({ list: [arr], start: [2] }).result).toEqual([2, 3, 4]);
    expect(new SliceNode().data({
      list: [arr], start: [2], end: [null as unknown as number],
    }).result).toBeNull();
  });
});

describe("figure sinks — empty figure for a datum, neutral default for styling", () => {
  it("Gauge (Bar style): value and target go blank, but the track's scale keeps the card's bound", () => {
    const node = new GaugeNode({ op: "bar" });
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

  it("chart options: a wired blank means NO styling, not the string on the card", () => {
    const node = new KpiNode();
    node.stringLiterals.options = "title=From the card";
    const out = node.data({ value: [5], options: [null as unknown as string] }).chart;
    expect(out.options.title).toBeUndefined();
    // UNWIRED still uses the typed options.
    const unwired = new KpiNode();
    unwired.stringLiterals.options = "title=From the card";
    expect(unwired.data({ value: [5] }).chart.options.title).toBe("From the card");
  });

  it("KPI: a wired blank prior shows NO comparison, not a compare against the card's number", () => {
    // The "absent is not unknown" trap: prev is an optional comparison, and a wired
    // blank leaves it unknown (no delta) rather than reusing the card's prior.
    const node = new KpiNode();
    node.literals.value = 5;
    node.literals.prev = 10;
    const blank = node.data({ value: [5], prev: [null as unknown as number] }).chart.payload as { prev: number | null };
    expect(blank.prev).toBeNull();
    // UNWIRED still compares against the card's prior.
    const unwired = new KpiNode();
    unwired.literals.prev = 10;
    const p = unwired.data({ value: [5] }).chart.payload as { prev: number | null };
    expect(p.prev).toBe(10);
  });
});

describe("Date mode-selector + active-op guard", () => {
  // A basis is a MODE selector: a wired blank propagates (unknown basis -> unknown
  // answer) on the ops that read it, but DAYS never reads basis so a blank there is
  // ignored. (The propagate-vs-default disposition is the recorded author call.)
  it("DAYS ignores a wired blank basis; YEARFRAC blanks on it", () => {
    const days = new DateDiffNode({ op: "days" });
    expect(days.data({ start: [46000], end: [46010], basis: [null as unknown as number] }).result).toBe(10);
    const yf = new DateDiffNode({ op: "yearfrac" });
    expect(yf.data({ start: [46000], end: [46010], basis: [null as unknown as number] }).result).toBeNull();
  });
});

describe("date operands", () => {
  it("DATE: a wired blank month propagates instead of defaulting to January", () => {
    const node = new DateConstructNode();
    node.literals.month = 6;
    expect(node.data({ year: [2026], month: [null as unknown as number], day: [1] }).result).toBeNull();
  });

  it("DATE: unwired parts still use the typed literals", () => {
    const node = new DateConstructNode();
    node.literals.year = 2026;
    node.literals.month = 3;
    node.literals.day = 15;
    expect(typeof node.data({}).result).toBe("number");
  });

  it("EDATE: a wired blank month offset propagates", () => {
    const node = new DateAddNode({ op: "edate" });
    node.literals.months = 1;
    expect(node.data({ start: [46096], months: [null as unknown as number] }).result).toBeNull();
    // Unwired offset keeps the literal — the value shifts, so it still computes.
    expect(typeof node.data({ start: [46096] }).result).toBe("number");
  });
});

// ─── The review sweep's second pass (2026-07-28) — misses the first pass left ──

describe("Kleene logic THROUGH the real coercion wrapper", () => {
  // The bare-data() tests above pass raw numbers, but the live engine coerces a
  // wired logical to a REAL boolean first (`numsToBools`), and `false !== 0` is
  // true — so AND(false, TRUE) computed as AND(true, true). These pin the family
  // through wrapNodeData, the exact path Canvas installs.
  function wrapped<T extends { data: (i: never) => unknown }>(node: T): T {
    wrapNodeData(node as never);
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

  it("Expect (range): a blank floor skips ONLY the floor — the ceiling still checks", () => {
    const node = new ExpectNode({ checkNotNull: false, checkRange: true });
    node.literals.max = 10;
    node.data({ in: [50], min: [null as unknown as number] });
    expect(node.violations).toContain("range");
  });
});

describe("the guard is scoped to the ACTIVE op — second pass", () => {
  const f: FrameValue = { __frame: true, columns: [{ name: "a", type: "number", values: [1, 2, 3] }] };

  it("Head (First N) ignores a wired blank To", async () => {
    const node = new HeadNode({ op: "first" });
    node.literals.rows = 2;
    const out = (await node.data({ frame: [f], to: [null as unknown as number] })).frame;
    expect(out).not.toBeNull();
  });

  it("Join (inner) ignores a wired blank Tolerance", async () => {
    const node = new JoinNode({ how: "inner" });
    node.stringLiterals.leftKey = "a";
    const out = (await node.data({ left: [f], right: [f], tolerance: [null as unknown as number] })).frame;
    expect(out).not.toBeNull();
  });

  it("REGEXTEST ignores a wired blank Replace-with", () => {
    const node = new RegexNode({ op: "test" });
    node.stringLiterals.pattern = "a";
    expect(node.data({ text: ["abc"], replacement: [null as unknown as string] }).result).toBe(1);
  });

  it("ODDLPRICE ignores `issue` entirely; ODDFPRICE blanks on a wired blank issue", () => {
    const f2 = new OddCouponNode({ op: "oddfprice" });
    const s = 45000, m = 48000, fl = 45100;
    const withIssue = f2.data({ settle: [s], maturity: [m], firstlast: [fl], issue: [44900] }).result;
    expect(withIssue).not.toBeNull();
    expect(f2.data({ settle: [s], maturity: [m], firstlast: [fl], issue: [null as unknown as number] }).result).toBeNull();
  });
});

describe("a column-LIST reference — same rule as the scalar column", () => {
  const f: FrameValue = { __frame: true, columns: [{ name: "a", type: "number", values: [1] }, { name: "b", type: "number", values: [2] }] };

  it("Columns (Keep): a WIRED blank list blanks the frame; the empty literal passes it through", async () => {
    const node = new ColumnsNode();
    expect((await node.data({ frame: [f], columns: [null as unknown as string[]] })).frame).toBeNull();
    expect((await new ColumnsNode().data({ frame: [f] })).frame).toEqual(f);
  });

  it("Columns (Drop): removes the named column and ignores an unknown name", async () => {
    const res = await new ColumnsNode({ op: "drop" }).data({ frame: [f], columns: [["b", "nope"]] });
    const out = (await readFrame(res.frame)) as FrameValue;
    expect(out.columns.map((c) => c.name)).toEqual(["a"]);
  });

  it("Columns (Keep): a name the frame lacks is a #REF! error", async () => {
    await expect(new ColumnsNode().data({ frame: [f], columns: [["nope"]] })).rejects.toMatchObject({ code: "#REF!" });
  });

  it("Columns: op round-trips through extractInit", () => {
    expect(extractInit(new ColumnsNode({ op: "drop" })).op).toBe("drop");
    expect(extractInit(new ColumnsNode()).op).toBe("keep");
  });
});

describe("per-cell contract in hand-rolled broadcasts", () => {
  it("Regex over a list: a missing cell propagates and an error cell rides along", () => {
    const err = solError("#DIV/0!", "upstream");
    const node = new RegexNode({ op: "test" });
    node.stringLiterals.pattern = "a";
    const out = node.data({ text: [["abc", null, err] as unknown as string[]] }).result;
    expect(out).toEqual([1, null, err]);
  });

  it("XIRR: an error cell in the cash flows surfaces as ITSELF, not #CONV!", () => {
    const err = solError("#DIV/0!", "upstream");
    const node = new IrrNode({ op: "dates" });
    const out = node.data({
      list: [[-1000, err as unknown as number, 600]],
      dates: [[45000, 45180, 45365]],
    }).result;
    expect(out).toBe(err);
  });

  it("XIRR: a missing DATE leaves the schedule unknown", () => {
    const node = new IrrNode({ op: "dates" });
    expect(node.data({ list: [[-1000, 600]], dates: [[45000, null as unknown as number]] }).result).toBeNull();
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

  it("SWITCH: an unknown expression matches NOTHING — not an unset When row", () => {
    const node = new SwitchNode();
    node.literals.then0 = 5;
    // Wired blank expr: unknown, propagates — must NOT return then0 via null === null.
    expect(node.data({ expr: [null] }).result).toBeNull();
  });
});

describe("figure controls never clobber the typed literal", () => {
  it("Histogram: a wired Bins value does not overwrite the card's literal", () => {
    const node = new HistogramNode();
    node.literals.bins = 10;
    node.data({ values: [[1, 2, 3]], bins: [4] });
    expect(node.literals.bins).toBe(10);
  });
});

describe("Distribution — a wired blank parameter propagates", () => {
  // The oneDistributionNode flagship: every param reads through readInput, so a wired
  // blank mean blanks the result while an unwired slot uses the seeded literal.
  it("NORM.DIST: a wired blank mean blanks the result; unwired uses the literals", () => {
    const node = new DistributionNode({ op: "normal", form: "cdf" });
    const firstKey = node.spec.xKey;
    expect(node.data({ [firstKey]: [0], mean: [null] }).result).toBeNull();
    expect(typeof node.data({}).result).toBe("number");
  });
});

describe("Rank & Percentile — active-family param guard", () => {
  // LARGE reads k: a wired blank k blanks the result, an unwired slot uses the seeded
  // literal. The list operand skips its own nulls before ranking.
  it("LARGE: a wired blank k blanks the result; unwired uses the literal", () => {
    const node = new RankPercentileNode({ op: "large" });
    expect(node.data({ list: [[3, 1, 2]], k: [null as unknown as number] }).result).toBeNull();
    expect(node.data({ list: [[3, 1, 2]] }).result).toBe(3); // k defaults to 1 -> largest
    expect(node.data({ list: [[3, 1, 2]], k: [2] }).result).toBe(2); // 2nd largest
  });
});

describe("Z.TEST", () => {
  it("a wired blank μ₀ propagates; an unwired σ still uses the sample std", () => {
    const node = new HypothesisTestNode({ op: "z" });
    expect(node.data({ a: [[1, 2, 3, 4]], x: [null as unknown as number] }).result).toBeNull();
    expect(node.data({ a: [[1, 2, 3, 4]] }).result).not.toBeNull();
    // A wired blank σ is unknown too — not "use the sample std".
    expect(node.data({ a: [[1, 2, 3, 4]], sigma: [null as unknown as number] }).result).toBeNull();
  });
});

describe("Input family — wired blank by role", () => {
  // Color A/B are operands: a wired blank propagates (blank out), it is NOT the
  // "isn't a color" #VALUE! that a typed-empty card gives.
  it("Color Blend: a wired blank color propagates, not a #VALUE! error", () => {
    const node = new ColorBlendNode({ mode: "mix" });
    expect(node.data({ a: [null as unknown as string] }).color).toBeNull();
    // Unwired still blends the two card colors.
    const out = node.data({}).color;
    expect(typeof out === "string" && out.startsWith("#")).toBe(true);
  });

  // COMPLEX's parts are operands — a blank real/imag makes the number unknown.
  it("COMPLEX: a wired blank part propagates; unwired uses the typed parts", () => {
    const node = new ComplexFromNode();
    expect(node.data({ re: [null as unknown as number] }).z).toBeNull();
    expect(node.data({}).z).not.toBeNull();
  });

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

describe("Lists ▸ Find — INDEX three-state read", () => {
  // INDEX reads an OMITTED axis (unwired, nothing typed) as the whole axis, a wired
  // blank as unknown (null), and a number as that 1-based position.
  it("INDEX: a wired blank index is null; a typed literal still indexes", () => {
    const node = new ListIndexNode();
    node.literals.index = 2;
    expect(node.data({ list: [[10, 20, 30]], index: [null as unknown as number] }).result).toBeNull();
    expect(node.data({ list: [[10, 20, 30]] }).result).toBe(20);
    expect(node.data({ list: [[10, 20, 30]], index: [3] }).result).toBe(30);
  });
});

describe("Lists ▸ Build/Shape — shape params and filter conditions", () => {
  // A Series shape param (count) blanks the whole list; unwired uses the seeded default.
  it("Series (linspace): a wired blank count blanks the list; unwired builds it", () => {
    const node = new SeriesNode({ op: "linspace" });
    expect(node.data({ count: [null as unknown as number] }).list).toBeNull();
    expect(Array.isArray(node.data({}).list)).toBe(true);
  });

  // A filter condition's comparison value is unevaluable when blank, so the whole result
  // is unknown (NOT the unfiltered list); an empty literal just skips the condition.
  it("List Filter: a wired blank comparison value blanks the result; empty literal passes through", () => {
    const node = new FilterNode();
    const [valueKey] = node.valueInputKeys();
    node.stringLiterals[valueKey] = "";
    expect(node.data({ list: [null as unknown as unknown[]] }).result).toBeNull();
    expect(node.data({ list: [[1, 2, 3]], [valueKey]: [null] }).result).toBeNull();
    expect(node.data({ list: [[1, 2, 3]] }).result).toEqual([1, 2, 3]);
  });
});

describe("Complex — operands with literals propagate a wired blank", () => {
  // Quadratic Roots reads a/b/c through readInput, so a wired blank coefficient blanks
  // the roots while an unwired slot solves the card's a x^2 + b x + c.
  it("Quadratic Roots: a wired blank coefficient blanks the roots; unwired solves the card", () => {
    const node = new QuadraticRootsNode();
    node.literals.a = 1; node.literals.b = 0; node.literals.c = 1;
    expect(node.data({ a: [null as unknown as number] }).x1).toBeNull();
    // Unwired solves x^2 + 1 = 0 -> a complex root, not null.
    expect(node.data({}).x1).not.toBeNull();
  });
});

describe("Combinatorics — the active-op guard scopes to the inputs it reads", () => {
  // FACT/FACTDOUBLE never read k, so a wired blank on k must NOT blank the result;
  // COMBIN reads both, so a wired blank k there is unknown. Same node, two dispositions.
  it("FACT ignores a wired blank k; COMBIN blanks on it", () => {
    const fact = new CombinatoricsNode({ op: "fact" });
    fact.literals.n = 5;
    expect(fact.data({ n: [5], k: [null as unknown as number] }).result).toBe(120);
    const combin = new CombinatoricsNode({ op: "combin" });
    combin.literals.n = 5; combin.literals.k = 2;
    expect(combin.data({ n: [5], k: [null as unknown as number] }).result).toBeNull();
    // A wired blank n blanks either op.
    expect(fact.data({ n: [null as unknown as number] }).result).toBeNull();
  });
});

describe("Numbers ▸ Arithmetic/Functions/Rounding — operands propagate", () => {
  // Scalar one-op nodes: an operand's wired blank makes the answer unknown per cell,
  // and only an unwired slot uses the typed literal.
  it("Arithmetic: a wired blank operand propagates; unwired uses the literals", () => {
    const node = new ArithmeticNode({ op: "add" });
    node.literals.a = 3; node.literals.b = 4;
    expect(node.data({ a: [null as unknown as number], b: [4] }).result).toBeNull();
    expect(node.data({}).result).toBe(7);
  });

  it("Math function: a wired blank input propagates; unwired uses the literal", () => {
    const node = new MathFnNode({ op: "abs" });
    node.literals.in = -5;
    expect(node.data({ in: [null as unknown as number] }).result).toBeNull();
    expect(node.data({}).result).toBe(5);
  });

  it("MROUND: a wired blank on value OR multiple propagates; unwired rounds", () => {
    const node = new MRoundNode({ op: "nearest" });
    node.literals.value = 7; node.literals.multiple = 5;
    expect(node.data({ value: [null as unknown as number] }).result).toBeNull();
    expect(node.data({ multiple: [null as unknown as number] }).result).toBeNull();
    expect(node.data({}).result).toBe(5);
  });
});

describe("Output family — wired blank by role", () => {
  // Expect's allowlist is a check parameter: a wired blank skips the check (like
  // min/max/pattern), it does NOT revert to the card's typed list.
  it("Expect: a wired blank allowlist skips the check; unwired uses the card list", () => {
    const node = new ExpectNode({ checkNotNull: false, checkAllowed: true });
    node.stringLiterals.allowed = "a,b";
    // Unwired: "x" is not in the card allowlist → violation.
    node.data({ in: [["x"]] });
    expect(node.violations).toContain("allowed");
    // Wired blank: the allowlist is unknown → the check is skipped, no violation.
    node.data({ in: [["x"]], allowed: [null as unknown as unknown[]] });
    expect(node.violations).not.toContain("allowed");
    // A wired allowlist still applies.
    node.data({ in: [["x"]], allowed: [["a", "b"]] });
    expect(node.violations).toContain("allowed");
  });

  // Alert: a blank on an input the active mode reads makes the status unknown, which
  // never fires; an unwired slot still evaluates against the card's literal.
  it("Alert: a wired blank value is unknown (null status); unwired uses the literal", () => {
    const node = new AlertNode({ condition: "range" });
    node.literals.value = 50; node.literals.low = 0; node.literals.high = 100;
    expect(node.data({ value: [null as unknown as number] }).result).toBeNull();
    expect(node.data({}).result).toBe(0);
  });
});

describe("Packs — domain nodes propagate a wired blank operand", () => {
  // Representative of the pack node classes: every one reads params via readInput and
  // guards to null, sharing its core with the matching pack formula.
  it("Colebrook: a wired blank Re blanks the result; unwired uses the seeded literals", () => {
    const node = new ColebrookNode();
    expect(node.data({ re: [null as unknown as number], rr: [0.0001] }).result).toBeNull();
    expect(typeof node.data({}).result).toBe("number");
  });
});

describe("Other — Cast and Convert on a wired blank", () => {
  // Cast is a relay that SEES errors: a blank input stays blank (not a failure), a
  // genuine parse failure is #VALUE!.
  it("Cast: a wired blank stays blank; an unparseable value is #VALUE!", () => {
    expect(new CastNode({ target: "number" }).data({ value: [null] }).result).toBeNull();
    expect(isSolError(new CastNode({ target: "number" }).data({ value: ["abc"] }).result)).toBe(true);
  });

  // Convert's input is the value operand: a wired blank propagates.
  it("Convert: a wired blank value propagates to blank", () => {
    expect(new ConvertNode().data({ in: [null] }).out).toBeNull();
  });
});

describe("Build Cube — a wired blank column name is unknown, not the default", () => {
  // The "read raw, guard, then trim" rule: a wired blank name blanks the cube, while an
  // untouched empty card reads as "" and falls back to the "Items" default.
  it("a wired blank name blanks the cube; unwired builds it with the default name", () => {
    const node = new BuildCubeNode();
    const [v0] = node.valueInputKeys();
    expect(node.data({ name: [null], [v0]: [1] }).cube).toBeNull();
    expect(node.data({ [v0]: [1] }).cube).not.toBeNull();
  });
});

describe("cube column references — read raw, guard, then trim", () => {
  it("Rollup: a wired blank output name is unknown, never the \"Total\" default", () => {
    const cube = {
      __cube: true,
      columns: [
        { name: "k", type: "string" as const, values: ["x"] },
        { name: "items", type: "frame" as const, values: [{ __frame: true, columns: [{ name: "v", type: "number" as const, values: [1] }] }] },
      ],
    };
    const node = new CubeRollupNode();
    node.stringLiterals.nested = "items";
    node.stringLiterals.column = "v";
    expect(node.data({ cube: [cube as never], as: [null as unknown as string] }).frame).toBeNull();
  });
});

describe("Tables ▸ Lambda — a blank shape dimension blanks the array", () => {
  // MAKEARRAY's rows/cols are the result SHAPE: a wired blank leaves it unknown -> null,
  // while unwired dimensions build the array from the card's formula.
  it("MAKEARRAY: a wired blank rows blanks the result; unwired builds it", () => {
    const node = new MakeArrayNode();
    node.literals.rows = 2; node.literals.cols = 3;
    expect(node.data({ rows: [null as unknown as number], cols: [3] }).result).toBeNull();
    const out = node.data({}).result;
    expect(Array.isArray(out) && out.length).toBe(2);
  });
});

describe("Tables ▸ Matrix — a blank matrix operand propagates", () => {
  // MMULT is the representative: a wired blank operand blanks the result, a valid pair
  // multiplies, and a non-conformable pair is #SHAPE! (not a silent blank).
  it("MMULT: blank operand -> null; valid -> product; mismatch -> #SHAPE!", () => {
    const node = new TableMultNode();
    expect(node.data({ a: [null as unknown as number[][]], b: [[[1], [2]]] }).result).toBeNull();
    expect(node.data({ a: [[[1, 2]]], b: [[[3], [4]]] }).result).toEqual([[11]]);
    expect(isSolError(node.data({ a: [[[1, 2]]], b: [[[3, 4]]] }).result)).toBe(true);
  });
});

describe("Set Cell — wired blank by role", () => {
  const M = (): (number | null)[][] => [[1, 2], [3, 4]];

  it("a wired blank ROW (an address) makes the whole result null", () => {
    const node = new SetCellNode(); // fresh: one row, literals row0=1 col0=1
    expect(node.data({ matrix: [M()], value0: [9], row0: [null], col0: [1] }).result).toBeNull();
  });

  it("a wired blank COLUMN makes the whole result null", () => {
    const node = new SetCellNode();
    expect(node.data({ matrix: [M()], value0: [9], row0: [1], col0: [null] }).result).toBeNull();
  });

  it("a wired blank VALUE (an operand) writes null into that cell", () => {
    const node = new SetCellNode();
    expect(node.data({ matrix: [M()], value0: [null], row0: [1], col0: [1] }).result)
      .toEqual([[null, 2], [3, 4]]);
  });

  it("a wired LIST value extends by shape — a row segment from the anchor", () => {
    const node = new SetCellNode();
    expect(node.data({ matrix: [M()], value0: [[10, 20]], row0: [1], col0: [1] }).result)
      .toEqual([[10, 20], [3, 4]]);
  });

  it("an UNWIRED row/col/value uses the card literals", () => {
    const node = new SetCellNode();
    node.literals = { row0: 2, col0: 2, value0: 99 };
    expect(node.data({ matrix: [M()] }).result).toEqual([[1, 2], [3, 99]]);
  });
});
