import { describe, it, expect } from "vitest";
import { parseListLiteral, wrapNodeData, TYPEABLE_LIST } from "./coerceInputs";
import { SolenoidSocket, AdoptiveSocket } from "./sockets";
import { ExpressionNode } from "./nodes/expression";
import { FLAT_CATALOG } from "./catalogUtils";

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
