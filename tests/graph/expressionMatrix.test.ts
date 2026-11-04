// [[C10]] socketLattice, [[C15]] matricesInFormulas, [[formula-language#The Expression node]]
import { describe, it, expect } from "vitest";
import { ExpressionNode } from "../../src/graph/nodes/expression";
import { throughBoundary } from "./boundaryKit";
import type { View } from "../../src/graph/view";
import { GraphEditor } from "../../src/graph/graphEditor";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import type { Schemes } from "../../src/graph/schemes";
import { processGraph, setEditorRefs } from "../../src/graph/process";
import { canConnect, SolenoidSocket } from "../../src/graph/sockets";

const run = (expr: string, inputs: Record<string, unknown[]>) => {
  const node = new ExpressionNode({ expr });
  throughBoundary(node as unknown as Parameters<typeof throughBoundary>[0]);
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

  it("per-cell null and error ride through a matrix formula ([[C24]] arraySemantics)", () => {
    const out = run("a + 1", { a: [[[1, null], [3, 4]]] }) as unknown[][];
    expect(out[0]).toEqual([2, null]);
    expect(out[1]).toEqual([4, 5]);
  });
});

describe("the connect-time gate ([[C10]] socketLattice acceptance)", () => {
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

describe("the result socket takes the rank and family of the value it carried ([[D117]] emptyKeepsLastType)", () => {
  it("a matrix answer types it a table, a scalar a list; an error keeps the last type", async () => {
    const editor = new GraphEditor<Schemes>();
    const engine = new DataflowEngine<Schemes>();
    editor.use(engine);
    setEditorRefs(editor, engine, { rerenderNode: async () => {}, rerenderCables: async () => {} } as unknown as View);
    const node = new ExpressionNode({ expr: "SEQUENCE(2, 2)" });
    await editor.addNode(node as unknown as Schemes["Node"]);
    const typed = async (expr: string) => {
      node.expr = expr;
      node.edited();
      await processGraph();
      return (node.outputs.result!.socket as unknown as { dataType: string }).dataType;
    };
    expect(await typed("SEQUENCE(2, 2)")).toBe("table");
    expect(await typed("1/0")).toBe("table");
    expect(await typed("3")).toBe("numlist");
    expect(await typed("\"a\"")).toBe("strcombo");
    expect(await typed("COMPLEX(3, 4)")).toBe("complexcombo");
    expect(await typed("MAKEARRAY(2, 2, LAMBDA(r, c, COMPLEX(r, c)))")).toBe("complextable");
  });
});
