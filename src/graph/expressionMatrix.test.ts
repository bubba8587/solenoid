import { describe, it, expect } from "vitest";
import { ExpressionNode } from "./nodes/expression";
import { wrapNodeData } from "./coerceInputs";
import { canConnect, SolenoidSocket } from "./sockets";
import { isSolError } from "./errorValue";

// ─── D23: the Expression lift (anydataWildcard) ────────────────────────────────────────
// The connect-time half of the matrix decision: variables are `anydata`, matrices
// flow in, the formula computes by the broadcast table (oneBroadcast — semantics pinned
// in broadcastRules.test.ts; THIS file pins the node-boundary lift), and the
// result socket reconciles its RANK to the value while keeping its FAMILY.

const run = (expr: string, inputs: Record<string, unknown[]>) => {
  const node = new ExpressionNode({ expr });
  wrapNodeData(node as unknown as Parameters<typeof wrapNodeData>[0]);
  return (node.data(inputs) as { result: unknown }).result;
};

const M = [[1, 2], [3, 4]];

describe("matrices flow into a formula (the lift itself)", () => {
  it("computes element-wise over a wired matrix", () => {
    expect(run("a * 2", { a: [M] })).toEqual([[2, 4], [6, 8]]);
  });

  it("mixes ranks by the broadcast table: matrix × list × scalar", () => {
    expect(run("m + row + 1", { m: [M], row: [[10, 20]] })).toEqual([[12, 23], [14, 25]]);
  });

  it("aggregates a matrix whole (SUM flattens row-major)", () => {
    expect(run("SUM(m)", { m: [M] })).toBe(10);
  });

  it("per-cell null and error ride through a matrix formula (nullSkippedNotZero/errorBeatsMissing)", () => {
    const out = run("a + 1", { a: [[[1, null], [3, 4]]] }) as unknown[][];
    expect(out[0]).toEqual([2, null]);
    expect(out[1]).toEqual([4, 5]);
  });

  it("the old cap's #SHAPE! is gone — this exact input used to refuse", () => {
    const r = run("a * 2", { a: [M] });
    expect(isSolError(r)).toBe(false);
  });
});

describe("the connect-time gate (anydataWildcard acceptance)", () => {
  it("a fresh Expression declares anydata variables", () => {
    const n = new ExpressionNode({ expr: "a + b" });
    for (const v of n.varNames) {
      const sock = n.inputs[v]?.socket;
      expect(sock instanceof SolenoidSocket && sock.dataType).toBe("anydata");
    }
  });

  it("every family matrix connects; frames, cubes and objects never do", () => {
    for (const t of ["table", "strtable", "datetable", "logicaltable", "complextable", "anytable"] as const) {
      expect(canConnect(t, "anydata"), t).toBe(true);
    }
    for (const t of ["frame", "cube", "lambda", "chart", "document"] as const) {
      expect(canConnect(t, "anydata"), t).toBe(false);
    }
  });
});

describe("the result socket reconciles RANK, keeps FAMILY (anydataWildcard + retypeReconciles)", () => {
  it("a matrix result marks the node rank-2; a scalar result marks it back", async () => {
    const node = new ExpressionNode({ expr: "a * 2" });
    wrapNodeData(node as unknown as Parameters<typeof wrapNodeData>[0]);
    // Headless (no active editor): the socket swap is skipped by design, but the
    // rank tracking that drives it must still follow the value.
    node.data({ a: [M] });
    expect((node as unknown as { lastResultRank: number }).lastResultRank).toBe(2);
    node.data({ a: [3] });
    await Promise.resolve(); // let the (no-op headless) microtask drain
    expect((node as unknown as { lastResultRank: number }).lastResultRank).toBe(1);
  });

  it("an error result leaves the rank alone (no flapping on failure)", () => {
    const node = new ExpressionNode({ expr: "a * 2" });
    wrapNodeData(node as unknown as Parameters<typeof wrapNodeData>[0]);
    node.data({ a: [M] });
    expect((node as unknown as { lastResultRank: number }).lastResultRank).toBe(2);
    node.data({ a: [{ __solError: true, code: "#DIV/0!", message: "x" }] });
    expect((node as unknown as { lastResultRank: number }).lastResultRank).toBe(2);
  });
});
