import { describe, it, expect } from "vitest";
import { parseListLiteral, wrapNodeData, TYPEABLE_LIST } from "./coerceInputs";
import { SolenoidSocket, AdoptiveSocket } from "./sockets";
import { ExpressionNode } from "./nodes/expression";
import { FLAT_CATALOG } from "./catalogUtils";
import { DatePartNode, parseDateToSerial } from "./nodes/date";
import { TextTransformNode } from "./nodes/text";
import { ComplexUnaryNode } from "./nodes/complex";
import { NotNode } from "./nodes/logic";
import { ArithmeticNode } from "./nodes/scalar";
import { ListLengthNode, ListInputNode } from "./nodes/list";

const MAR_2026 = parseDateToSerial("2026-03-20");
const APR_2027 = parseDateToSerial("2027-04-21");

// Persistence restores `literals` / `stringLiterals` only onto classes that
// DECLARE the map (the inline-editability convention — a wire-driven card like
// the Equation family declares neither, so a save can't hardcode an invisible
// known). The typeable-list CSV editor stores its text in `stringLiterals`, so
// any node with a strlist/datelist/logicallist input MUST declare the map or
// the user's typed CSV silently drops on reload.
describe("typeable-list inputs imply a declared stringLiterals map", () => {
  it("every catalog node with a typeable list input declares stringLiterals", () => {
    const broken: string[] = [];
    for (const [type, entry] of FLAT_CATALOG.entries()) {
      let n: unknown;
      try { n = entry.create(); } catch { continue; } // constructability is another test's job
      const anyN = n as { inputs?: Record<string, { socket?: unknown } | undefined>; stringLiterals?: unknown };
      const typeable = Object.entries(anyN.inputs ?? {}).filter(([, p]) =>
        p?.socket instanceof SolenoidSocket && TYPEABLE_LIST.has(p.socket.dataType));
      if (typeable.length > 0 && typeof anyN.stringLiterals !== "object") {
        broken.push(`${type}: typeable input(s) ${typeable.map(([k]) => k).join(", ")} but no stringLiterals declaration`);
      }
    }
    expect(broken, broken.join("\n")).toEqual([]);
  });
});

describe("parseListLiteral — typed 1-D list literals", () => {
  it("strlist: split on commas, trim, drop empties", () => {
    expect(parseListLiteral("name, qty ,", "strlist")).toEqual(["name", "qty"]);
  });
  it("strlist: a quoted field keeps its embedded comma (RFC 4180)", () => {
    expect(parseListLiteral('"First, Last", qty', "strlist")).toEqual(["First, Last", "qty"]);
    expect(parseListLiteral('"He said ""hi""", x', "strlist")).toEqual(['He said "hi"', "x"]);
  });
  it("datelist: each part → a date serial", () => {
    expect(parseListLiteral("2026-03-15", "datelist")).toEqual([46096]);
  });
  it("logicallist: each part → a boolean (TRUE/FALSE, 0/1)", () => {
    expect(parseListLiteral("true, 0, FALSE, 1", "logicallist")).toEqual([true, false, false, true]);
  });
});

describe("coerceInputs — typed-list literal injection", () => {
  function mockNode(literal: string | undefined) {
    let received: Record<string, unknown[]> | undefined;
    const node = {
      data: (inputs: Record<string, unknown[]>) => { received = inputs; return {}; },
      inputs: { cols: { socket: new SolenoidSocket("strlist") } },
      stringLiterals: literal === undefined ? {} : { cols: literal },
    };
    wrapNodeData(node as Parameters<typeof wrapNodeData>[0]);
    return { run: (inputs: Record<string, unknown[]>) => { node.data(inputs); return received ?? {}; } };
  }

  it("injects the parsed list for an UNWIRED strlist input", () => {
    expect(mockNode("a, b").run({}).cols).toEqual([["a", "b"]]);
  });
  it("a WIRED value wins over the literal", () => {
    expect(mockNode("a, b").run({ cols: [["x", "y", "z"]] }).cols).toEqual([["x", "y", "z"]]);
  });
  it("an empty wired array still falls back to the literal (like a scalar ??)", () => {
    expect(mockNode("a, b").run({ cols: [] }).cols).toEqual([["a", "b"]]);
  });
  it("no literal → the input stays absent (no field typed)", () => {
    expect(mockNode(undefined).run({}).cols).toBeUndefined();
  });
});

describe("coerceInputs — an adoptive CONTAINER input coerces on its BASE rung, not the adopted type", () => {
  // The bug this pins: a scalar widens into an adoptive `anylist` input, so the socket
  // ADOPTS `number` for colour — but the node's data() expects a list, so coercion must
  // still widen the scalar to `[scalar]` (the base rung), not keep it a bare number.
  function run(base: string, adopted: string, wired: unknown) {
    const sock = new AdoptiveSocket(base as never);
    sock.setType(adopted as never); // simulate settleWildcardTypes adopting the wired type
    let received: Record<string, unknown[]> | undefined;
    const node = {
      data: (inputs: Record<string, unknown[]>) => { received = inputs; return {}; },
      inputs: { list: { socket: sock } },
    };
    wrapNodeData(node as Parameters<typeof wrapNodeData>[0]);
    node.data({ list: [wired] });
    return received!.list?.[0];
  }

  it("a scalar into an adopted `anylist` input widens to a singleton", () => {
    expect(run("anylist", "number", 5)).toEqual([5]);   // was 5 (bug) — now [5]
    expect(run("anylist", "string", "x")).toEqual(["x"]);
  });
  it("a list into an adopted `anylist` input passes through", () => {
    expect(run("anylist", "numlist", [1, 2, 3])).toEqual([1, 2, 3]);
  });
  it("an adopted `anytable` input passes the value through (the node's toAnyMatrix widens)", () => {
    // anytable coercion is a pass-through either way; the point is that the adopted
    // scalar type doesn't force a DIFFERENT coercion (toScalar) than the base rung.
    expect(run("anytable", "number", 7)).toBe(7);
  });
});

describe("coerceInputs — noWidenInputs: opt out of rank widening, keep element coercion", () => {
  // The generalized "unsubscribe from widening" hook. A node lists input keys that keep
  // their NATURAL rank (scalar stays scalar) instead of widening to the socket's rank,
  // while element coercion (logical→number) still applies and the socket is unchanged.
  function run(base: string, key: string, wired: unknown, noWiden: boolean) {
    let received: Record<string, unknown[]> | undefined;
    const node = {
      data: (inputs: Record<string, unknown[]>) => { received = inputs; return {}; },
      inputs: { [key]: { socket: new SolenoidSocket(base as never) } },
      noWidenInputs: noWiden ? new Set([key]) : undefined,
    };
    wrapNodeData(node as unknown as Parameters<typeof wrapNodeData>[0]);
    node.data({ [key]: [wired] });
    return received![key]?.[0];
  }

  it("a scalar into a `list` input stays a scalar when opted out (vs widening to [scalar])", () => {
    expect(run("list", "x", 5, false)).toEqual([5]); // default: widened
    expect(run("list", "x", 5, true)).toBe(5);        // opted out: natural rank
  });
  it("element coercion (logical→number) still applies to the un-widened value", () => {
    expect(run("list", "x", true, true)).toBe(1); // bool→num, but not wrapped
  });
  it("a list still passes through unchanged", () => {
    expect(run("list", "x", [1, 2, 3], true)).toEqual([1, 2, 3]);
  });
});

describe("coerceInputs — Expression is a broadcaster: its variables opt out of widening", () => {
  // Regression: a scalar into Expression's `anylist` variable input was widened to
  // `[scalar]` (the Set/position rule above), so `a+b` of two scalars broadcast to a
  // 1-element LIST. Expression declares its variables in noWidenInputs so the evaluator
  // sees the natural rank and returns a scalar for scalar inputs, a list for a list.
  function runExpr(expr: string, inputs: Record<string, unknown[]>) {
    const node = new ExpressionNode({ expr });
    wrapNodeData(node as unknown as Parameters<typeof wrapNodeData>[0]);
    return (node.data(inputs) as { result: unknown }).result;
  }

  it("noWidenInputs tracks the formula variables", () => {
    const node = new ExpressionNode({ expr: "a + b" });
    expect([...node.noWidenInputs].sort()).toEqual(["a", "b"]);
    node.expr = "x * y - z";
    node._rebuild();
    expect([...node.noWidenInputs].sort()).toEqual(["x", "y", "z"]);
  });
  it("scalar inputs → a SCALAR result (not a 1-element list)", () => {
    expect(runExpr("a + b", { a: [5], b: [3] })).toBe(8);
  });
  it("a list input still broadcasts to a list", () => {
    expect(runExpr("a + b", { a: [[1, 2, 3]], b: [10] })).toEqual([11, 12, 13]);
  });
});

// ─── A one-element list IS the scalar, at any rung that can be rank 0 ─────────
// Reported against `List Input [Date]` (one entry) → YEAR: it emitted a LIST of one
// year instead of the year. Author: "combo socket mutates single value down into
// Scalar — that's what the combo socket is supposed to do. If I didn't want that,
// I'd use the strict-list socket."
//
// He's right, and the inconsistency was ours: `toScalar` has always collapsed a
// one-element list for the numeric SCALAR rung, so the COMBO — the rung that
// generalizes it — was the stricter of the two. The lattice already permits
// combo→scalar on the grounds that "a combo can be a scalar" (sockets.ts calls it a
// runtime-accepted risk); collapsing is what makes that promise true.
describe("coerceInputs — a one-element list collapses at a combo / scalar socket", () => {
  const run = <T>(node: T, inputs: Record<string, unknown[]>) => {
    wrapNodeData(node as unknown as Parameters<typeof wrapNodeData>[0]);
    return (node as { data(i: Record<string, unknown[]>): { result: unknown } }).data(inputs).result;
  };

  it("the reported case: one date in → a scalar year out", () => {
    expect(run(new DatePartNode({ op: "year" }), { date: [[MAR_2026]] })).toBe(2026);
  });

  it("a genuine multi-element list still broadcasts to a list", () => {
    expect(run(new DatePartNode({ op: "year" }), { date: [[MAR_2026, APR_2027]] })).toEqual([2026, 2027]);
  });

  it("collapses for every element family's combo, not just dates", () => {
    expect(run(new TextTransformNode({ op: "upper" }), { text: [["a"]] })).toBe("A");
    expect(run(new TextTransformNode({ op: "upper" }), { text: [["a", "b"]] })).toEqual(["A", "B"]);
    expect(run(new NotNode(), { in: [[true]] })).toBe(false);
    expect(run(new ArithmeticNode({ op: "add" }), { a: [[2]], b: [[3]] })).toBe(5);
  });

  // A complex value is ITSELF a `[re, im]` array, so the collapse tests the OUTER
  // length only — otherwise one complex number would be mistaken for a 1-element list
  // and torn in half.
  it("does NOT tear a complex scalar apart", () => {
    expect(run(new ComplexUnaryNode({ op: "conj" }), { z: [[1, 2]] })).toEqual([1, -2]);      // one complex
    expect(run(new ComplexUnaryNode({ op: "conj" }), { z: [[[1, 2]]] })).toEqual([1, -2]);    // a 1-list of it
    expect(run(new ComplexUnaryNode({ op: "conj" }), { z: [[[1, 2], [3, 4]]] })).toEqual([[1, -2], [3, -4]]);
  });

  // The other half of the rule: a STRICT list socket keeps its list — that IS the
  // difference between the two rungs — and re-widens a scalar on the way in, so the
  // round trip through a collapse is lossless.
  it("a STRICT list socket keeps a one-element list, and re-widens a scalar", () => {
    const len = (v: unknown) => run(new ListLengthNode(), { list: [v] });
    expect(len([7])).toBe(1);      // a 1-element list is STILL a list to LENGTH
    expect(len([7, 8])).toBe(2);
    expect(len(7)).toBe(1);        // and a bare scalar widens into one
    const empty = new ListInputNode({ dataType: "date" });
    wrapNodeData(empty as never);
    empty.stringLiterals.v0 = "2026-03-20";
    expect((empty.data({}) as { list: unknown[] }).list).toEqual([MAR_2026]); // the SOURCE still emits a list
  });
});
