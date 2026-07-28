import { describe, it, expect } from "vitest";
import { TextTransformNode, TextSliceNode, ReptNode, TextSplitNode, TextFilterNode, ConcatNode } from "./text";
import { DateConstructNode, DateAddNode, NetworkdaysNode } from "./date";
import { BooleanOpNode, NotNode } from "./logic";
import { SliderInputNode } from "./input";
import { ExpressionNode } from "./expression";
import { ClampNode } from "./scalar";
import { MirrNode, TBillNode } from "./finance";
import { SortFrameNode, JoinNode } from "./frame";
import type { FrameValue } from "../frame";
import { solError, isSolError } from "../errorValue";

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

  it("Text Filter: a wired blank pattern yields blank, not an unfiltered list", () => {
    const node = new TextFilterNode({ op: "contains" });
    node.stringLiterals.pattern = "a";
    expect(node.data({ strings: [["ab", "cd"]], pattern: [null as unknown as string] }).result).toBeNull();
    expect(node.data({ strings: [["ab", "cd"]] }).result).toEqual(["ab"]);
  });

  it("NETWORKDAYS: a wired blank weekend code yields blank, not the default week", () => {
    const node = new NetworkdaysNode();
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
});

describe("Kleene logic — a wired blank is UNKNOWN, not FALSE", () => {
  // The sharpest form of this bug. `?? 0` didn't just lose the literal, it asserted
  // a definite FALSE where the graph said "unknown" — and under three-valued logic
  // those give different answers: AND(unknown, TRUE) is unknown, AND(FALSE, TRUE)
  // is FALSE. NOT made it visible by flipping: NOT(blank) answered TRUE.
  it("AND with a wired blank is unknown, not false", () => {
    const node = new BooleanOpNode({ op: "and" });
    const keys = Object.keys(node.inputs);
    const inputs: Record<string, (number | null)[] | undefined> = {};
    inputs[keys[0]] = [null];
    inputs[keys[1]] = [1];
    expect(node.data(inputs).result).toBeNull();
  });

  it("AND with a wired blank AND a definite FALSE is still false", () => {
    // Kleene: one FALSE settles the conjunction whatever else is unknown.
    const node = new BooleanOpNode({ op: "and" });
    const keys = Object.keys(node.inputs);
    const inputs: Record<string, (number | null)[] | undefined> = {};
    inputs[keys[0]] = [null];
    inputs[keys[1]] = [0];
    expect(node.data(inputs).result).toBe(false);
  });

  it("NOT of a wired blank is unknown, not TRUE", () => {
    const node = new NotNode();
    expect(node.data({ in: [null] }).result).toBeNull();
    // Unwired still uses the literal.
    expect(node.data({}).result).toBe(true); // NOT(0) — the default literal
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
    const node = new TBillNode({ op: "tbillyield" });
    node.literals.price = 97.5;
    const out = node.data({
      settle: [46096], maturity: [46187], discount: [null as unknown as number],
    }).result;
    expect(typeof out).toBe("number");
    // Its OWN input still propagates.
    expect(node.data({
      settle: [46096], maturity: [46187], price: [null as unknown as number],
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
