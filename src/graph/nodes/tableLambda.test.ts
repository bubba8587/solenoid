import { describe, it, expect } from "vitest";
import { MapTableNode, ByAxisNode, ReduceLambdaNode, ScanLambdaNode } from "./tableLambda";
import { LambdaNode, isLambdaValue, formatLambda, formatLambdaSig, lambdaSigMismatch, type LambdaValue } from "./lambda";
import { isSolError, type SolError } from "../errorValue";

/** Narrow a node result the test knows is a lambda value (the node now returns a
 *  SolError on a broken lambda, so the union needs a guard before .params/.fn). */
function asLambda(v: unknown): LambdaValue {
  if (!isLambdaValue(v)) throw new Error(`expected a lambda value, got ${JSON.stringify(v)}`);
  return v;
}

describe("Lambda (LAMBDA value)", () => {
  it("emits a callable value binding params positionally", () => {
    const n = new LambdaNode({ params: "a, b", expr: "a * b + 1" });
    const v = asLambda(n.data({}).result);
    expect(v.params).toEqual(["a", "b"]);
    expect(v.fn(3, 4)).toBe(13);
    expect(formatLambda(v)).toBe("λ(a, b)");
  });

  it("captures non-parameter variables from inputs and literals", () => {
    const n = new LambdaNode({ params: "x", expr: "x * rate + base" });
    expect(n.captured).toEqual(["rate", "base"]);
    n.literals.base = 100;
    const v = asLambda(n.data({ rate: [2] }).result);
    expect(v.fn(5)).toBe(110);
  });

  it("re-derives captured sockets when params change", () => {
    const n = new LambdaNode({ params: "x", expr: "x * k" });
    expect(n.captured).toEqual(["k"]);
    n.params = "x, k";
    const { removed } = n._rebuild();
    expect(removed).toEqual(["k"]);
    expect(n.captured).toEqual([]);
    expect(asLambda(n.data({}).result).fn(3, 4)).toBe(12);
  });

  it("flags bad parameter names and syntax errors as typed errors", () => {
    // The inline cachedError keeps the rich message; the result is a tagged error
    // so a broken lambda propagates down its cable instead of silently no-op'ing.
    const bad = new LambdaNode({ params: "x, 2y", expr: "x" });
    const badR = bad.data({}).result;
    expect(isSolError(badR)).toBe(true);
    expect((badR as SolError).code).toBe("#NAME?");
    expect(bad.cachedError).toBe("Bad parameter name");
    const syn = new LambdaNode({ params: "x", expr: "x +* 1" });
    const synR = syn.data({}).result;
    expect(isSolError(synR)).toBe(true);
    expect((synR as SolError).code).toBe("#SYNTAX!");
    expect(syn.cachedError).toBe("Syntax error");
    // A blank body is still a legitimate no-value, not an error.
    expect(new LambdaNode({ params: "x", expr: "" }).data({}).result).toBeNull();
  });
});

describe("Lambda wired into consumers", () => {
  const lambdaOf = (params: string, expr: string, inputs = {}) =>
    new LambdaNode({ params, expr }).data(inputs).result!;

  it("overrides MAP's inline formula, binding (x, y)", () => {
    const map = new MapTableNode({ expr: "x + 1000" });
    const lam = lambdaOf("v, w", "v * w");
    expect(map.data({ table: [[[1, 2]]], table2: [[[10, 20]]], lambda: [lam] }).result)
      .toEqual([[10, 40]]);
  });

  it("overrides REDUCE's inline formula, binding (acc, x)", () => {
    const red = new ReduceLambdaNode();
    const lam = lambdaOf("total, v", "total + v * v");
    expect(red.data({ table: [[[1, 2, 3]]], lambda: [lam] }).result).toBe(14);
  });

  it("a captured value rides the closure into the consumer", () => {
    const red = new ReduceLambdaNode();
    const lam = lambdaOf("acc, v", "acc + v * scale", { scale: [10] });
    expect(red.data({ table: [[[1, 2]]], lambda: [lam] }).result).toBe(30);
  });

  it("rejects a lambda with more params than the node provides", () => {
    const by = new ByAxisNode();
    const lam = lambdaOf("a, b", "a + b");
    const r = by.data({ table: [[[1, 2]]], lambda: [lam] }).result;
    expect(isSolError(r)).toBe(true);
    expect((r as SolError).code).toBe("#VALUE!");
    expect(by.cachedError).toMatch(/Lambda takes 2 values/);
  });

  it("BYROW accepts a 1-param lambda over the row vector", () => {
    const by = new ByAxisNode();
    const lam = lambdaOf("row", "MAX(row) - MIN(row)");
    expect(by.data({ table: [[[1, 5], [10, 2]]], lambda: [lam] }).result).toEqual([4, 8]);
  });
});

describe("MapTable (MAP)", () => {
  it("maps a single table with the default x^2", () => {
    const n = new MapTableNode();
    expect(n.data({ table: [[[1, 2], [3, 4]]] }).result).toEqual([[1, 4], [9, 16]]);
    expect(n.cachedError).toBeNull();
  });

  it("zips two same-shape tables through x and y", () => {
    const n = new MapTableNode({ expr: "x * y" });
    expect(n.data({ table: [[[1, 2], [3, 4]]], table2: [[[10, 20], [30, 40]]] }).result)
      .toEqual([[10, 40], [90, 160]]);
  });

  it("zips three tables", () => {
    const n = new MapTableNode({ expr: "x + y + z" });
    expect(n.data({
      table: [[[1, 2]]], table2: [[[10, 20]]], table3: [[[100, 200]]],
    }).result).toEqual([[111, 222]]);
  });

  it("broadcasts a 1×1 second table over every cell", () => {
    const n = new MapTableNode({ expr: "x * y" });
    expect(n.data({ table: [[[1, 2], [3, 4]]], table2: [[[10]]] }).result)
      .toEqual([[10, 20], [30, 40]]);
  });

  it("errors on a shape mismatch", () => {
    const n = new MapTableNode({ expr: "x * y" });
    const r = n.data({ table: [[[1, 2], [3, 4]]], table2: [[[1, 2, 3]]] }).result;
    expect(isSolError(r)).toBe(true);
    expect((r as SolError).code).toBe("#SHAPE!");
    expect(n.cachedError).toMatch(/Shape mismatch/);
  });

  it("exposes the 1-based position as r and c", () => {
    const n = new MapTableNode({ expr: "r * 10 + c" });
    expect(n.data({ table: [[[0, 0], [0, 0]]] }).result).toEqual([[11, 12], [21, 22]]);
  });
});

describe("ReduceLambda (REDUCE)", () => {
  it("folds a list with the default acc + x from initial 0", () => {
    const n = new ReduceLambdaNode();
    expect(n.data({ table: [[[1, 2, 3, 4]]] }).result).toBe(10);
    expect(n.cachedError).toBeNull();
  });

  it("starts from the wired initial value", () => {
    const n = new ReduceLambdaNode();
    expect(n.data({ initial: [5], table: [[[1, 2, 3]]] }).result).toBe(11);
  });

  it("starts from the inline initial literal when unwired", () => {
    const n = new ReduceLambdaNode();
    n.literals.initial = 100;
    expect(n.data({ table: [[[1, 2]]] }).result).toBe(103);
  });

  it("folds a matrix row-major, matching Excel", () => {
    // acc*10 + x encodes visit order in the digits: [[1,2],[3,4]] → 1234.
    const n = new ReduceLambdaNode({ expr: "acc * 10 + x" });
    expect(n.data({ table: [[[1, 2], [3, 4]]] }).result).toBe(1234);
  });

  it("exposes the 1-based position as i", () => {
    const n = new ReduceLambdaNode({ expr: "acc + x * i" });
    expect(n.data({ table: [[[1, 2, 3]]] }).result).toBe(1 + 4 + 9);
  });

  it("resolves Excel functions in the formula", () => {
    const n = new ReduceLambdaNode({ expr: "MAX(acc, x)" });
    expect(n.data({ initial: [-999], table: [[[3, 7, 2]]] }).result).toBe(7);
  });

  it("returns null with no values wired", () => {
    const n = new ReduceLambdaNode();
    expect(n.data({}).result).toBeNull();
    expect(n.cachedError).toBeNull();
  });

  it("flags a syntax error", () => {
    const n = new ReduceLambdaNode({ expr: "acc +* x" });
    const r = n.data({ table: [[[1]]] }).result;
    expect(isSolError(r)).toBe(true);
    expect((r as SolError).code).toBe("#SYNTAX!");
    expect(n.cachedError).toBe("Syntax error");
  });
});

describe("ScanLambda (SCAN)", () => {
  it("emits the running accumulator per cell (default acc + x from 0)", () => {
    const n = new ScanLambdaNode();
    expect(n.data({ table: [[[1, 2, 3, 4]]] }).result).toEqual([[1, 3, 6, 10]]);
    expect(n.cachedError).toBeNull();
  });

  it("starts the running fold from the wired initial", () => {
    const n = new ScanLambdaNode();
    expect(n.data({ initial: [5], table: [[[1, 2, 3]]] }).result).toEqual([[6, 8, 11]]);
  });

  it("scans a matrix row-major, keeping the input's shape", () => {
    const n = new ScanLambdaNode();
    expect(n.data({ table: [[[1, 2], [3, 4]]] }).result).toEqual([[1, 3], [6, 10]]);
  });

  it("runs an arbitrary formula — a running max, and the 1-based position i", () => {
    const max = new ScanLambdaNode({ expr: "MAX(acc, x)" });
    expect(max.data({ initial: [-999], table: [[[3, 7, 2, 9, 5]]] }).result).toEqual([[3, 7, 7, 9, 9]]);
    const idx = new ScanLambdaNode({ expr: "acc + x * i" });
    expect(idx.data({ table: [[[1, 2, 3]]] }).result).toEqual([[1, 5, 14]]);
  });

  it("returns null with no values wired; flags a syntax error", () => {
    expect(new ScanLambdaNode().data({}).result).toBeNull();
    const bad = new ScanLambdaNode({ expr: "acc +* x" }).data({ table: [[[1]]] }).result;
    expect(isSolError(bad) && (bad as SolError).code).toBe("#SYNTAX!");
  });

  // The Initial input is a SCALAR seed. It was an `anyListIn` (list socket), so a
  // wired scalar arrived wrapped as `[v]`; `acc` then started as an array, the
  // fold broadcast to arrays, and every cell nulled out ("1×10 blank table").
  // REDUCE shared the bug. Guard the socket type on both.
  it("seeds from a scalar `any` socket, not a list (regression: blank table)", () => {
    expect(new ScanLambdaNode().inputs.initial!.socket.name).toBe("any");
    expect(new ReduceLambdaNode().inputs.initial!.socket.name).toBe("any");
  });

  // A wired lambda binds POSITIONALLY to (acc, x, i); its param NAMES are cosmetic.
  // The card flags any declaration that isn't an ordered prefix so the names can't
  // silently lie (λ(x) drops acc; λ(x, acc) swaps them). SCAN/REDUCE advertise it.
  it("flags a wired lambda whose params aren't the (acc, x, i) prefix", () => {
    const sig = new ScanLambdaNode().lambdaSig;
    expect(formatLambdaSig(sig)).toBe("acc, x, [i]");
    expect(lambdaSigMismatch(["acc", "x"], sig)).toBe(false);       // correct
    expect(lambdaSigMismatch(["acc", "x", "i"], sig)).toBe(false);  // correct, with i
    expect(lambdaSigMismatch(["x"], sig)).toBe(true);               // acc dropped
    expect(lambdaSigMismatch(["x", "acc"], sig)).toBe(true);        // order swapped
    expect(lambdaSigMismatch(["a", "b"], sig)).toBe(true);          // arbitrary names
    expect(new ReduceLambdaNode().lambdaSig).toEqual(sig);
  });
});
